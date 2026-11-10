import { callSafely } from "@/presentation/call-safely";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("consumer callback isolation", () => {
  it("passes the argument to a callback and accepts an absent callback", () => {
    const callback = jest.fn();
    callSafely(callback, "token", "onTokenGenerated");
    expect(callback).toHaveBeenCalledWith("token");
    expect(() => callSafely(undefined, "token", "onTokenGenerated")).not.toThrow();
  });

  it.each(["onTokenGenerated", "onError"] as const)("logs only the prop name for %s", (name) => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      callSafely(
        () => {
          throw new Error("private details");
        },
        "private token",
        name,
      ),
    ).not.toThrow();
    expect(log.mock.calls).toEqual([[`[recaptcha-next] ${name} threw`]]);
  });
});
