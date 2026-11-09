import { useEffect, useRef, useState } from "react";
import { RECAPTCHA_TOKEN_FIELD, TOKEN_REFRESH_MARGIN_MS, TOKEN_TTL_MS } from "../domain";
import { readSiteKey } from "./readSiteKey";
import { useRecaptcha } from "./useRecaptcha";

export interface RecaptchaFieldProps {
  /** Action name, checked again on the server. */
  action: string;
  /** Defaults to `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`. */
  siteKey?: string;
  /** Name of the hidden input. Defaults to `g-recaptcha-response`. */
  name?: string;
  /**
   * Wait until the form is near the viewport before loading the script. A submit before that
   * loads the script too, but its own data goes out without a token, so only the next one has one.
   */
  lazy?: boolean;
  /** How early lazy loading starts, as a CSS margin. Defaults to `200px`. */
  lazyRootMargin?: string;
  /** Milliseconds between token refreshes. Defaults to 90 seconds. */
  refreshIntervalMs?: number;
  /**
   * Called on every new token, once the token is already in the hidden input, so reading or
   * submitting the form inside it sends this token. Unstable function props are safe, no
   * `useCallback` needed.
   */
  onTokenGenerated?: (token: string) => void;
  /**
   * Called each time loading the script, making a token or a renewal fails. Failed renewals are
   * retried, with a growing delay, so this can fire more than once in a row.
   */
  onError?: (error: Error) => void;
}

const DEFAULT_REFRESH_MS = TOKEN_TTL_MS - TOKEN_REFRESH_MARGIN_MS;
/** First delay before retrying a failed token request. Each further failure doubles it. */
const RETRY_DELAY_MS = 5_000;
/** The retry delay never grows past this. */
const RETRY_MAX_DELAY_MS = 30_000;
/** A token request that has not answered by then counts as failed, so the next one can start. */
const EXECUTE_TIMEOUT_MS = 10_000;

/** Rejects if `pending` has not settled within `ms`. The late result, if any, is ignored. */
function withTimeout<T>(pending: Promise<T>, ms: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`reCAPTCHA did not answer within ${ms / 1000} seconds`)),
      ms,
    );
  });
  return Promise.race([pending, expired]).finally(() => clearTimeout(timeout));
}

/**
 * Renders a hidden input that holds a token for the current action and site key. It is empty
 * until the first token arrives, again after a change until the new token arrives, and after a
 * form submit until the renewal for that submit arrives (or stays empty if the renewal fails).
 * A token also goes empty when its two minutes pass, and a failed renewal is retried.
 * Renders nothing without a site key.
 *
 * The token is spent when the form's data is read. The field clears it and asks for a new one on
 * the `formdata` event, which fires when the browser builds the form data for a submit. A submit
 * that is canceled (for example by validation) builds no form data, so it renews nothing.
 *
 * Reading the form with `new FormData(form)` also fires `formdata`, so it renews the token too,
 * and the FormData you just built still carries the token it read. Read the form once, at submit
 * time, and send that same FormData.
 */
export function RecaptchaField({
  action,
  siteKey: siteKeyProp,
  name = RECAPTCHA_TOKEN_FIELD,
  lazy = false,
  lazyRootMargin = "200px",
  refreshIntervalMs = DEFAULT_REFRESH_MS,
  onTokenGenerated,
  onError,
}: RecaptchaFieldProps) {
  const siteKey = siteKeyProp ?? readSiteKey();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(!lazy);
  // A token is only shown for the action and site key it was made with, so a change
  // leaves the field empty until the new token arrives, never with the old action's token.
  const tokenKey = `${siteKey}\n${action}`;
  const [issued, setIssued] = useState<{ key: string; value: string } | null>(null);
  const token = issued?.key === tokenKey ? issued.value : "";

  // Callbacks live in refs, so a new function identity on each render
  // cannot restart the token effect.
  const onTokenRef = useRef(onTokenGenerated);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTokenRef.current = onTokenGenerated;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!lazy || visible) return;
    const anchor = anchorRef.current;
    const form = anchor?.closest("form") ?? null;
    const target = form ?? anchor?.parentElement ?? anchor;
    // Without IntersectionObserver (old browsers, some test setups) load right away.
    if (!target || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    // A submit before the field is visible (a programmatic requestSubmit, say) shows it, so the
    // script loads and the next submit has a token. The submit that triggered this has none.
    const show = () => setVisible(true);
    form?.addEventListener("submit", show);
    form?.addEventListener("formdata", show);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: lazyRootMargin },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
      form?.removeEventListener("submit", show);
      form?.removeEventListener("formdata", show);
    };
  }, [lazy, visible, lazyRootMargin]);

  const { status, error, execute } = useRecaptcha({ action, siteKey, enabled: visible });

  useEffect(() => {
    if (error) onErrorRef.current?.(error);
  }, [error]);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    // Next refresh, or the retry after a failure. Only one of them is pending at a time.
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The renewal after a form's data was read. It waits for the current task, so two
    // formdata events of one submit become one request.
    let renewal: ReturnType<typeof setTimeout> | undefined;
    // Drops the token when its TTL passes. Cleared whenever the token is replaced or spent.
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let renewAgain = false;
    let failures = 0;

    const refresh = async () => {
      // One request at a time. A submit that arrives meanwhile asks for one more afterwards.
      if (inFlight) {
        renewAgain = true;
        return;
      }
      inFlight = true;
      clearTimeout(timer);
      let next = "";
      let renewed = false;
      try {
        next = await withTimeout(execute(), EXECUTE_TIMEOUT_MS);
        renewed = true;
      } catch (cause) {
        if (!cancelled)
          onErrorRef.current?.(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        inFlight = false;
      }
      if (cancelled) return;
      if (renewed) {
        failures = 0;
        // The input is controlled, so React writes the new value only after the next render. The
        // callback runs before that, and a consumer that reads or submits the form in it must
        // already see this token. Write it now, in the same task. The state below holds the same
        // value, so the render that follows changes nothing.
        if (inputRef.current) inputRef.current.value = next;
        setIssued({ key: tokenKey, value: next });
        onTokenRef.current?.(next);
        clearTimeout(expiry);
        expiry = setTimeout(() => {
          // Clear only the token that was issued here, never a newer one.
          setIssued((current) =>
            current?.key === tokenKey && current.value === next ? null : current,
          );
        }, TOKEN_TTL_MS);
      } else {
        failures += 1;
      }
      if (renewAgain) {
        renewAgain = false;
        void refresh();
      } else if (renewed) {
        timer = setTimeout(refresh, refreshIntervalMs);
      } else {
        const delay = Math.min(RETRY_DELAY_MS * 2 ** (failures - 1), RETRY_MAX_DELAY_MS);
        timer = setTimeout(refresh, delay);
      }
    };

    // The browser has already read the spent token into this FormData, so it can be dropped
    // now. The field is emptied at once, not after a render, so a read that follows in the same
    // task cannot send it.
    const onFormData = () => {
      clearTimeout(expiry);
      if (inputRef.current) inputRef.current.value = "";
      setIssued(null);
      if (renewal !== undefined) return;
      renewal = setTimeout(() => {
        renewal = undefined;
        void refresh();
      }, 0);
    };
    const form = anchorRef.current?.closest("form") ?? null;
    form?.addEventListener("formdata", onFormData);

    void refresh();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(renewal);
      clearTimeout(expiry);
      form?.removeEventListener("formdata", onFormData);
    };
  }, [status, execute, refreshIntervalMs, tokenKey]);

  if (!siteKey) return null;

  return (
    <span ref={anchorRef} data-recaptcha-field="">
      <input ref={inputRef} type="hidden" name={name} value={token} readOnly />
    </span>
  );
}
