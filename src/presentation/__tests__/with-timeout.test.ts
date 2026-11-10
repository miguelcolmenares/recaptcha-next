import { withTimeout } from "@/presentation/with-timeout";

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("request deadline", () => {
  it("returns the result and removes its timer", async () => {
    const abort = new AbortController();
    await expect(withTimeout(Promise.resolve("token"), 1000, abort.signal)).resolves.toBe("token");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("rejects when the request times out", async () => {
    const abort = new AbortController();
    const pending = withTimeout(new Promise(() => {}), 1000, abort.signal);
    const checked = expect(pending).rejects.toThrow("reCAPTCHA did not answer within 1 seconds");
    await jest.advanceTimersByTimeAsync(1000);
    await checked;
    expect(jest.getTimerCount()).toBe(0);
  });

  it("cancels immediately and removes the deadline", async () => {
    const abort = new AbortController();
    const pending = withTimeout(new Promise(() => {}), 1000, abort.signal);
    abort.abort();
    expect(jest.getTimerCount()).toBe(0);
    await expect(pending).rejects.toThrow("reCAPTCHA request was cancelled");
  });
});
