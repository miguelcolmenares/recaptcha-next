import { TOKEN_TTL_MS } from "@/domain";
import { callSafely } from "./call-safely";
import { withTimeout } from "./with-timeout";

/** First delay before retrying a failed token request. Each further failure doubles it. */
const RETRY_DELAY_MS = 5_000;
/** The retry delay never grows past this. */
const RETRY_MAX_DELAY_MS = 30_000;
/** A request that has not answered by then counts as failed, so the next one can start. */
const EXECUTE_TIMEOUT_MS = 10_000;

export interface TokenRenewalOptions {
  execute: () => Promise<string>;
  getRefreshInterval: () => number;
  /** Commits the token synchronously, before a consumer callback can read it. */
  onChange: (token: string) => void;
  onTokenGenerated?: (token: string) => void;
  onError?: (error: Error) => void;
}

/** Owns one token lifecycle. It has no React or DOM dependencies. */
export function createTokenRenewal(options: TokenRenewalOptions) {
  let cancelled = false;
  const cancellation = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let failures = 0;
  let token = "";

  const publish = (next: string) => {
    token = next;
    options.onChange(next);
  };

  const refresh = async () => {
    if (cancelled || inFlight) return;
    inFlight = true;
    clearTimeout(timer);
    let next = "";
    let failure: Error | undefined;
    try {
      next = await withTimeout(options.execute(), EXECUTE_TIMEOUT_MS, cancellation.signal);
    } catch (cause) {
      failure = cause instanceof Error ? cause : new Error(String(cause));
    } finally {
      inFlight = false;
    }
    if (cancelled) return;

    // Commit the token and schedule everything before calling consumer code.
    if (failure === undefined) {
      failures = 0;
      publish(next);
      clearTimeout(expiry);
      expiry = setTimeout(() => {
        if (token === next) publish("");
      }, TOKEN_TTL_MS);
      timer = setTimeout(
        refresh,
        Math.min(options.getRefreshInterval(), TOKEN_TTL_MS - EXECUTE_TIMEOUT_MS),
      );
    } else {
      failures += 1;
      const delay = Math.min(RETRY_DELAY_MS * 2 ** (failures - 1), RETRY_MAX_DELAY_MS);
      timer = setTimeout(refresh, delay);
    }

    if (failure === undefined) callSafely(options.onTokenGenerated, next, "onTokenGenerated");
    else callSafely(options.onError, failure, "onError");
  };

  return {
    start: () => void refresh(),
    /** A form read spends the current token, even if a replacement is already in flight. */
    spendToken() {
      if (cancelled) return;
      const spent = token;
      clearTimeout(expiry);
      publish("");
      if (spent === "" || inFlight || renewal !== undefined) return;
      // Defer to the next task so multiple reads cause only one renewal.
      renewal = setTimeout(() => {
        renewal = undefined;
        // A replacement that arrived since the read has not been spent yet.
        if (inFlight || token !== "") return;
        void refresh();
      }, 0);
    },
    stop() {
      cancelled = true;
      cancellation.abort();
      clearTimeout(timer);
      clearTimeout(renewal);
      clearTimeout(expiry);
      publish("");
    },
  };
}
