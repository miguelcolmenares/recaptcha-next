import { useCallback, useEffect, useRef, useState } from "react";
// Deep import on purpose: the infrastructure barrel also exports the Google verify
// gateway, which must not end up in the browser bundle.
import { loadRecaptcha } from "../infrastructure/scriptLoader";
import type { Grecaptcha } from "../infrastructure/scriptLoader";
import { readSiteKey } from "./readSiteKey";

export type RecaptchaStatus = "idle" | "loading" | "ready" | "error";

export interface UseRecaptchaOptions {
  /** Action name, checked again on the server. */
  action: string;
  /** Defaults to `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`. */
  siteKey?: string;
  /** Set to false to postpone loading the script. */
  enabled?: boolean;
}

export interface UseRecaptchaResult {
  status: RecaptchaStatus;
  error: Error | null;
  /** Get a fresh token. Waits for the script when it is still loading. */
  execute: () => Promise<string>;
}

interface LoadState {
  key: string;
  status: "ready" | "error";
  error: Error | null;
}

/** First wait before loading the script again after a failure. Each further failure doubles it. */
const LOAD_RETRY_DELAY_MS = 5_000;
/** The wait between load attempts never grows past this. */
const LOAD_RETRY_MAX_DELAY_MS = 30_000;

/**
 * Loads Google's script for a site key and gives a function that makes tokens. A failed load is
 * tried again after 5, 10, 20 and then 30 seconds, until it works, the key changes or the
 * component unmounts. Every failed attempt is reported once, as `error`.
 */
export function useRecaptcha({
  action,
  siteKey: siteKeyOption,
  enabled = true,
}: UseRecaptchaOptions): UseRecaptchaResult {
  const siteKey = siteKeyOption ?? readSiteKey();
  const active = enabled && Boolean(siteKey);
  const [state, setState] = useState<LoadState | null>(null);
  // Counts the retries. A new value runs the load effect again, which starts the next attempt.
  const [attempt, setAttempt] = useState(0);
  const grecaptchaRef = useRef<Promise<Grecaptcha> | null>(null);
  // Failed attempts in a row for one key. A new key, or a success, starts the count again.
  const failures = useRef({ key: "", count: 0 });

  useEffect(() => {
    if (!active || !siteKey) return;
    if (failures.current.key !== siteKey) failures.current = { key: siteKey, count: 0 };
    const pending = loadRecaptcha(siteKey);
    grecaptchaRef.current = pending;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    pending.then(
      () => {
        if (cancelled) return;
        failures.current.count = 0;
        setState({ key: siteKey, status: "ready", error: null });
      },
      (error: unknown) => {
        if (cancelled) return;
        const delay = Math.min(
          LOAD_RETRY_DELAY_MS * 2 ** failures.current.count,
          LOAD_RETRY_MAX_DELAY_MS,
        );
        failures.current.count += 1;
        setState({
          key: siteKey,
          status: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        });
        retry = setTimeout(() => setAttempt((count) => count + 1), delay);
      },
    );
    return () => {
      cancelled = true;
      clearTimeout(retry);
      grecaptchaRef.current = null;
      // A new load starts from nothing. Keeping the last result would show a key's old failure
      // again when it comes back (A to B to A), or an old error while a retry is under way.
      setState(null);
    };
  }, [active, siteKey, attempt]);

  const execute = useCallback(async () => {
    const pending = grecaptchaRef.current;
    if (!pending || !siteKey) throw new Error("reCAPTCHA is not enabled or has no site key");
    const grecaptcha = await pending;
    return grecaptcha.execute(siteKey, { action });
  }, [siteKey, action]);

  // Status is derived, so the effect never has to set state just to say "loading".
  const current = state && state.key === siteKey ? state : null;
  const status: RecaptchaStatus = !active ? "idle" : (current?.status ?? "loading");
  return { status, error: current?.error ?? null, execute };
}
