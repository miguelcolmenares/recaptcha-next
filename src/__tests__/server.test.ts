import { isRecaptchaEnabled, verifyRecaptcha } from "../server";

const originalEnvironment = process.env;

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env = { ...originalEnvironment };
  delete process.env.RECAPTCHA_SECRET_KEY;
});

afterEach(() => {
  process.env = originalEnvironment;
  jest.restoreAllMocks();
});

describe("default server environment policy", () => {
  it.each(["production", undefined, "", "staging", "Production", " development "])(
    "requires verification when NODE_ENV is %p",
    async (environment) => {
      if (environment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = environment;

      expect(isRecaptchaEnabled()).toBe(true);
      const result = isRecaptchaEnabled() ? await verifyRecaptcha("token") : { success: true };
      expect(result).toEqual({ success: false, reason: "missing-secret" });
    },
  );

  it.each(["development", "test"])(
    "allows unconfigured verification in %s",
    async (environment) => {
      process.env.NODE_ENV = environment;
      expect(isRecaptchaEnabled()).toBe(false);
      expect(await verifyRecaptcha("token")).toEqual({
        success: true,
        skipped: true,
        reason: "missing-secret-in-development",
      });
    },
  );

  it("requires verification when a development secret is configured", () => {
    process.env.NODE_ENV = "development";
    process.env.RECAPTCHA_SECRET_KEY = "configured-key";
    expect(isRecaptchaEnabled()).toBe(true);
  });
});

describe("default server failure logging", () => {
  it.each([
    [{ success: true, score: 0.2, action: "contact" }, "low-score", 0.2, undefined],
    [
      { success: false, "error-codes": ["timeout-or-duplicate"] },
      "rejected-by-google",
      undefined,
      ["timeout-or-duplicate"],
    ],
  ])("logs safe metadata from %p", async (response, reason, score, errorCodes) => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(response)));
    jest.resetModules();
    const { verifyRecaptcha: verify } = await import("../server");
    await verify("private-test-token", { secret: "private-test-secret" });
    expect(console.error).toHaveBeenCalledWith("[recaptcha-next] verification failed", {
      reason,
      score,
      errorCodes,
    });
    const output = JSON.stringify(jest.mocked(console.error).mock.calls);
    expect(output).not.toContain("private-test-token");
    expect(output).not.toContain("private-test-secret");
  });

  it("keeps successful verification quiet", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true, score: 0.9 })));
    jest.resetModules();
    const { verifyRecaptcha: verify } = await import("../server");
    expect((await verify("private-test-token", { secret: "private-test-secret" })).success).toBe(
      true,
    );
    expect(console.error).not.toHaveBeenCalled();
  });
});
