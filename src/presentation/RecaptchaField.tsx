import { useEffect, useRef, useState } from "react";
import { RECAPTCHA_TOKEN_FIELD, TOKEN_REFRESH_MARGIN_MS, TOKEN_TTL_MS } from "../domain";
import { callSafely } from "./callSafely";
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
  /** Milliseconds between token refreshes. Defaults to 90 seconds. A change applies from the next refresh. */
  refreshIntervalMs?: number;
  /**
   * Called on every new token, once the token is already in the hidden input, so reading or
   * submitting the form inside it sends this token. Unstable function props are safe, no
   * `useCallback` needed. A callback that throws is logged with `console.error` and otherwise
   * ignored.
   */
  onTokenGenerated?: (token: string) => void;
  /**
   * Called each time loading the script, making a token or a renewal fails. Failed loads and
   * renewals are retried, with a growing delay, so this can fire more than once in a row, once per
   * failed attempt. A callback that throws is logged with `console.error` and otherwise ignored.
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
 * A token also goes empty when its two minutes pass, and a failed renewal is retried. A change of
 * action or site key ends the token, so going from one pair to another and back never shows the
 * old one. Renders nothing without a site key.
 *
 * The token is spent when the form's data is read. The field clears it and asks for a new one on
 * the `formdata` event, which fires when the browser builds the form data for a submit. A submit
 * that is canceled (for example by validation) builds no form data, so it renews nothing. It asks
 * only when a token was spent: a read of an empty field, or while a request is in flight, asks
 * for nothing, and a `formdata` event from a nested form is ignored.
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
  // The interval is read each time a refresh is scheduled, so changing it never restarts the
  // token effect or asks for a token nobody wanted.
  const refreshIntervalRef = useRef(refreshIntervalMs);
  useEffect(() => {
    onTokenRef.current = onTokenGenerated;
    onErrorRef.current = onError;
    refreshIntervalRef.current = refreshIntervalMs;
  });

  useEffect(() => {
    // Without a site key nothing is rendered, so there is no anchor to watch. Wait for the key,
    // rather than treating the missing anchor as a reason to load at once.
    if (!lazy || visible || !siteKey) return;
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
  }, [lazy, visible, lazyRootMargin, siteKey]);

  const { status, error, execute } = useRecaptcha({ action, siteKey, enabled: visible });

  useEffect(() => {
    if (error) callSafely(onErrorRef.current, error, "onError");
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
    // Counts the tokens issued, so a renewal task can tell that one arrived after the read.
    let issuedCount = 0;
    let failures = 0;

    const refresh = async () => {
      // One request at a time.
      if (inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      let next = "";
      let failure: Error | undefined;
      try {
        next = await withTimeout(execute(), EXECUTE_TIMEOUT_MS);
      } catch (cause) {
        failure = cause instanceof Error ? cause : new Error(String(cause));
      } finally {
        inFlight = false;
      }
      if (cancelled) return;

      // All bookkeeping comes first (the input, the expiry timer, the failure count and the next
      // request). A callback runs last and through `callSafely`, so one that throws cannot skip
      // any of it.
      if (failure === undefined) {
        failures = 0;
        // The input is controlled, so React writes the new value only after the next render. The
        // callback runs before that, and a consumer that reads or submits the form in it must
        // already see this token. Write it now, in the same task. The state below holds the same
        // value, so the render that follows changes nothing.
        if (inputRef.current) inputRef.current.value = next;
        setIssued({ key: tokenKey, value: next });
        issuedCount += 1;
        clearTimeout(expiry);
        expiry = setTimeout(() => {
          // Clear only the token that was issued here, never a newer one.
          if (inputRef.current?.value === next) inputRef.current.value = "";
          setIssued((current) =>
            current?.key === tokenKey && current.value === next ? null : current,
          );
        }, TOKEN_TTL_MS);
      } else {
        failures += 1;
      }
      if (failure === undefined) {
        timer = setTimeout(refresh, refreshIntervalRef.current);
      } else {
        const delay = Math.min(RETRY_DELAY_MS * 2 ** (failures - 1), RETRY_MAX_DELAY_MS);
        timer = setTimeout(refresh, delay);
      }

      if (failure === undefined) callSafely(onTokenRef.current, next, "onTokenGenerated");
      else callSafely(onErrorRef.current, failure, "onError");
    };

    // The browser has already read the spent token into this FormData, so it can be dropped
    // now. The field is emptied at once, not after a render, so a read that follows in the same
    // task cannot send it. A renewal is asked for only when a token was actually spent: an empty
    // field has nothing to replace, and a request in flight will deliver a token that was never
    // read. A failing renewal keeps its backoff this way, and one read means one request.
    const onFormData = (event: Event) => {
      // formdata bubbles, so a form nested in this one must not spend this field's token.
      if (event.target !== form) return;
      const spent = inputRef.current?.value ?? "";
      clearTimeout(expiry);
      if (inputRef.current) inputRef.current.value = "";
      setIssued(null);
      if (spent === "" || inFlight || renewal !== undefined) return;
      const issuedBefore = issuedCount;
      renewal = setTimeout(() => {
        renewal = undefined;
        // A request started after the read has delivered its token by now, and it was not read.
        if (inFlight || issuedCount !== issuedBefore) return;
        void refresh();
      }, 0);
    };
    const form = anchorRef.current?.closest("form") ?? null;
    form?.addEventListener("formdata", onFormData);

    void refresh();

    // The state is keyed by the pair, but it outlives this effect. Without clearing it here,
    // going from A to B and back to A shows A's old token again, with no expiry timer left to
    // drop it. Leaving the pair ends the token, in the state and in the input.
    const input = inputRef.current;
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(renewal);
      clearTimeout(expiry);
      form?.removeEventListener("formdata", onFormData);
      if (input) input.value = "";
      setIssued(null);
    };
  }, [status, execute, tokenKey]);

  if (!siteKey) return null;

  return (
    <span ref={anchorRef} data-recaptcha-field="">
      <input ref={inputRef} type="hidden" name={name} value={token} readOnly />
    </span>
  );
}
