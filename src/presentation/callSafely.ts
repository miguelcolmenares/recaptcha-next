/** Prefix of every message this package writes to the console. */
const LOG_TAG = "[recaptcha-next]";

/**
 * Calls a consumer's callback and keeps its failure away from the package. A callback that
 * throws is logged by its prop name only and never rethrown, so a bug in it cannot stop the
 * renewal loop, skip its timers, or reach a React error boundary.
 *
 * @param callback - The consumer's callback. Nothing happens when it is undefined.
 * @param argument - The value passed to the callback.
 * @param name - The prop name, used in the log message.
 */
export function callSafely<T>(
  callback: ((argument: T) => void) | undefined,
  argument: T,
  name: "onTokenGenerated" | "onError",
): void {
  try {
    callback?.(argument);
  } catch {
    console.error(`${LOG_TAG} ${name} threw`);
  }
}
