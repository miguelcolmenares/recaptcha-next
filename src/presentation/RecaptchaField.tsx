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
  /** Wait until the form is near the viewport before loading the script. */
  lazy?: boolean;
  /** How early lazy loading starts, as a CSS margin. Defaults to `200px`. */
  lazyRootMargin?: string;
  /** Milliseconds between token refreshes. Defaults to 90 seconds. */
  refreshIntervalMs?: number;
  /** Called on every new token. Unstable function props are safe, no `useCallback` needed. */
  onTokenGenerated?: (token: string) => void;
  /** Called when loading the script or making a token fails. */
  onError?: (error: Error) => void;
}

const DEFAULT_REFRESH_MS = TOKEN_TTL_MS - TOKEN_REFRESH_MARGIN_MS;

/** Renders a hidden input that always holds a valid token. Renders nothing without a site key. */
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
  const [visible, setVisible] = useState(!lazy);
  const [token, setToken] = useState("");

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
    const target = anchor?.closest("form") ?? anchor?.parentElement ?? anchor;
    // Without IntersectionObserver (old browsers, some test setups) load right away.
    if (!target || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
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
    return () => observer.disconnect();
  }, [lazy, visible, lazyRootMargin]);

  const { status, error, execute } = useRecaptcha({ action, siteKey, enabled: visible });

  useEffect(() => {
    if (error) onErrorRef.current?.(error);
  }, [error]);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let renewal: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let renewAgain = false;

    const refresh = async () => {
      // One request at a time. A submit that arrives meanwhile asks for one more afterwards.
      if (inFlight) {
        renewAgain = true;
        return;
      }
      inFlight = true;
      clearTimeout(timer);
      let renewed = false;
      try {
        const next = await execute();
        if (cancelled) return;
        setToken(next);
        onTokenRef.current?.(next);
        renewed = true;
      } catch (cause) {
        if (!cancelled)
          onErrorRef.current?.(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        inFlight = false;
      }
      if (cancelled) return;
      if (renewAgain) {
        renewAgain = false;
        void refresh();
      } else if (renewed) {
        timer = setTimeout(refresh, refreshIntervalMs);
      }
    };

    // A submit has already read the spent token, so the new one is requested
    // after the current task. That also merges the submit and formdata events of
    // one submit into a single request.
    const requestRenewal = () => {
      if (renewal !== undefined) return;
      renewal = setTimeout(() => {
        renewal = undefined;
        void refresh();
      }, 0);
    };
    const form = anchorRef.current?.closest("form") ?? null;
    form?.addEventListener("submit", requestRenewal);
    form?.addEventListener("formdata", requestRenewal);

    void refresh();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(renewal);
      form?.removeEventListener("submit", requestRenewal);
      form?.removeEventListener("formdata", requestRenewal);
    };
  }, [status, execute, refreshIntervalMs]);

  if (!siteKey) return null;

  return (
    <span ref={anchorRef} data-recaptcha-field="">
      <input type="hidden" name={name} value={token} readOnly />
    </span>
  );
}
