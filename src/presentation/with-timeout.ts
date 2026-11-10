/** Stops waiting on timeout or lifecycle cancellation. Late results are ignored. */
export function withTimeout<T>(pending: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`reCAPTCHA did not answer within ${ms / 1000} seconds`)),
      ms,
    );
    onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("reCAPTCHA request was cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([pending, expired]).finally(() => {
    clearTimeout(timeout);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}
