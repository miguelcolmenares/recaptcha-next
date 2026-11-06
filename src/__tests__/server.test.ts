import { isRecaptchaEnabled, verifyRecaptcha } from "../server";

const originalEnvironment = process.env;

beforeEach(() => {
  process.env = { ...originalEnvironment };
  delete process.env.RECAPTCHA_SECRET_KEY;
});

afterEach(() => {
  process.env = originalEnvironment;
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
