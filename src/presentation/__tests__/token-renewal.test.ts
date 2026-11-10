import { createTokenRenewal } from "@/presentation/token-renewal";

function lifecycle(interval = 90_000) {
  let token = "";
  const execute = jest.fn<Promise<string>, []>().mockResolvedValue("token-1");
  const onTokenGenerated = jest.fn();
  const onError = jest.fn();
  const getRefreshInterval = jest.fn(() => interval);
  const onChange = jest.fn((value: string) => {
    token = value;
  });
  const controller = createTokenRenewal({
    execute,
    getRefreshInterval,
    onChange,
    onTokenGenerated,
    onError,
  });
  return {
    ...controller,
    execute,
    getRefreshInterval,
    onChange,
    onTokenGenerated,
    onError,
    value: () => token,
  };
}

const advance = (ms = 0) => jest.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("token renewal without React or a DOM", () => {
  it("commits before notifying, and refreshes from the moment the request finishes", async () => {
    const flow = lifecycle(1000);
    flow.onTokenGenerated.mockImplementation((token: string) => expect(flow.value()).toBe(token));
    flow.start();
    await advance();
    expect(flow.value()).toBe("token-1");
    flow.execute.mockResolvedValue("token-2");
    await advance(999);
    expect(flow.execute).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(flow.value()).toBe("token-2");
    expect(flow.onTokenGenerated).toHaveBeenCalledTimes(2);
    flow.stop();
  });

  it("backs off after every failure, caps the delay, and reports each attempt", async () => {
    const flow = lifecycle();
    flow.execute.mockRejectedValue("offline");
    flow.start();
    await advance();
    expect(flow.onError).toHaveBeenCalledWith(new Error("offline"));
    for (const [index, delay] of [5000, 10_000, 20_000, 30_000, 30_000].entries()) {
      await advance(delay - 1);
      expect(flow.execute).toHaveBeenCalledTimes(index + 1);
      await advance(1);
      expect(flow.onError).toHaveBeenCalledTimes(index + 2);
    }
    expect(flow.value()).toBe("");
    flow.stop();
  });

  it("resets backoff after recovery", async () => {
    const flow = lifecycle(1000);
    flow.execute.mockRejectedValueOnce(new Error("offline"));
    flow.start();
    await advance();
    await advance(5000);
    expect(flow.value()).toBe("token-1");
    flow.execute.mockRejectedValueOnce(new Error("offline again"));
    await advance(1000);
    await advance(4999);
    expect(flow.execute).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(flow.execute).toHaveBeenCalledTimes(4);
    flow.stop();
  });

  it("expires the token even when every renewal fails", async () => {
    const flow = lifecycle();
    flow.execute.mockResolvedValueOnce("token-1").mockRejectedValue(new Error("offline"));
    flow.start();
    await advance();
    await advance(119_999);
    expect(flow.value()).toBe("token-1");
    await advance(1);
    expect(flow.value()).toBe("");
    flow.stop();
  });

  it("caps the refresh interval and ignores a result that arrives after its deadline", async () => {
    const flow = lifecycle(500_000);
    let late!: (token: string) => void;
    flow.execute
      .mockResolvedValueOnce("first")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            late = resolve;
          }),
      )
      .mockResolvedValue("fresh");
    flow.start();
    await advance();
    await advance(109_999);
    expect(flow.execute).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(flow.execute).toHaveBeenCalledTimes(2);
    await advance(10_000);
    expect(flow.onError).toHaveBeenCalledWith(
      new Error("reCAPTCHA did not answer within 10 seconds"),
    );
    expect(flow.value()).toBe("");
    await advance(5000);
    expect(flow.value()).toBe("fresh");
    late("stale");
    await advance();
    expect(flow.value()).toBe("fresh");
    expect(flow.onTokenGenerated).not.toHaveBeenCalledWith("stale");
    flow.stop();
  });

  it("clears a spent token synchronously and merges reads into one deferred renewal", async () => {
    const flow = lifecycle();
    flow.start();
    await advance();
    flow.execute.mockResolvedValue("replacement");
    flow.spendToken();
    expect(flow.value()).toBe("");
    flow.spendToken();
    expect(flow.execute).toHaveBeenCalledTimes(1);
    await advance();
    expect(flow.execute).toHaveBeenCalledTimes(2);
    expect(flow.value()).toBe("replacement");
    flow.stop();
  });

  it("does not bypass failure backoff when an empty token is read", async () => {
    const flow = lifecycle();
    flow.execute.mockRejectedValue(new Error("down"));
    flow.start();
    await advance();
    flow.spendToken();
    flow.spendToken();
    await advance(4999);
    expect(flow.execute).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(flow.execute).toHaveBeenCalledTimes(2);
    flow.stop();
  });

  it("keeps an unspent replacement that arrives before a queued renewal", async () => {
    const flow = lifecycle(1000);
    flow.execute.mockResolvedValueOnce("first").mockResolvedValue("replacement");
    // This read runs first at 1000 ms, then the interval produces a token before the queued task.
    setTimeout(() => flow.spendToken(), 1000);
    flow.start();
    await advance();
    await advance(1000);
    expect(flow.value()).toBe("replacement");
    // A zero-delay task created during a fake-timer tick runs one millisecond later.
    await advance(1);
    expect(flow.value()).toBe("replacement");
    expect(flow.execute).toHaveBeenCalledTimes(2);
    flow.stop();
  });

  it("renews a replacement consumed before an earlier read's queued task", async () => {
    const flow = lifecycle(1000);
    flow.execute
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("replacement")
      .mockResolvedValue("last");
    setTimeout(() => flow.spendToken(), 1000);
    flow.onTokenGenerated.mockImplementation((token: string) => {
      if (token === "replacement") flow.spendToken();
    });
    flow.start();
    await advance();
    await advance(1000);
    expect(flow.value()).toBe("");
    await advance(1);
    expect(flow.value()).toBe("last");
    expect(flow.execute).toHaveBeenCalledTimes(3);
    flow.stop();
  });

  it("allows only one pending request, and never adds a request for an in-flight form read", async () => {
    const flow = lifecycle(1000);
    let complete!: (token: string) => void;
    flow.execute.mockResolvedValueOnce("first").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    flow.start();
    flow.start();
    await advance();
    expect(flow.execute).toHaveBeenCalledTimes(1);
    await advance(1000);
    flow.spendToken();
    flow.spendToken();
    await advance();
    expect(flow.execute).toHaveBeenCalledTimes(2);
    complete("replacement");
    await advance();
    expect(flow.value()).toBe("replacement");
    flow.stop();
  });

  it("clears deadlines, ignores late results, and prevents new work after cancellation", async () => {
    const flow = lifecycle();
    let complete!: (token: string) => void;
    flow.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    flow.start();
    expect(jest.getTimerCount()).toBe(1);
    flow.stop();
    expect(jest.getTimerCount()).toBe(0);
    complete("late");
    await advance();
    flow.start();
    flow.spendToken();
    await advance(180_000);
    expect(flow.execute).toHaveBeenCalledTimes(1);
    expect(flow.onTokenGenerated).not.toHaveBeenCalled();
    expect(flow.onError).not.toHaveBeenCalled();
    expect(flow.value()).toBe("");
  });

  it.each(["onTokenGenerated", "onError"] as const)(
    "keeps timers running when %s throws",
    async (name) => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      const flow = lifecycle(1000);
      flow[name].mockImplementation(() => {
        throw new Error("private contents");
      });
      if (name === "onError") flow.execute.mockRejectedValue(new Error("down"));
      flow.start();
      await advance();
      await advance(name === "onError" ? 5000 : 1000);
      expect(flow.execute).toHaveBeenCalledTimes(2);
      expect(log.mock.calls).toEqual([
        [`[recaptcha-next] ${name} threw`],
        [`[recaptcha-next] ${name} threw`],
      ]);
      flow.stop();
    },
  );
});
