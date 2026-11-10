import type { VerifierDependencies } from "@/application/verify-recaptcha";
import { createVerifyRecaptcha } from "@/application/verify-recaptcha";

function setup(overrides: Partial<VerifierDependencies> = {}) {
  const verify = jest.fn().mockResolvedValue({
    success: true,
    score: 0.9,
    action: "login",
    hostname: "example.com",
  });
  const warn = jest.fn();
  const deps: VerifierDependencies = {
    gateway: { verify },
    getSecret: () => "env-secret",
    isProduction: () => false,
    warn,
    ...overrides,
  };
  return { verifyRecaptcha: createVerifyRecaptcha(deps), verify, warn };
}

describe("createVerifyRecaptcha", () => {
  it("fails with missing-token and does not call Google", async () => {
    const { verifyRecaptcha, verify } = setup();
    expect(await verifyRecaptcha(null)).toEqual({ success: false, reason: "missing-token" });
    expect(await verifyRecaptcha("")).toEqual({ success: false, reason: "missing-token" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("sends the env secret, the token and the remote IP to the gateway", async () => {
    const { verifyRecaptcha, verify } = setup();
    const result = await verifyRecaptcha("tok", { remoteIp: "1.2.3.4" });
    expect(result.success).toBe(true);
    expect(verify).toHaveBeenCalledWith({
      secret: "env-secret",
      token: "tok",
      remoteIp: "1.2.3.4",
    });
  });

  it("prefers the secret passed in options", async () => {
    const { verifyRecaptcha, verify } = setup();
    await verifyRecaptcha("tok", { secret: "explicit" });
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ secret: "explicit" }));
  });

  it("fails closed in production when the secret is missing", async () => {
    const { verifyRecaptcha, verify, warn } = setup({
      getSecret: () => undefined,
      isProduction: () => true,
    });
    expect(await verifyRecaptcha("tok")).toEqual({ success: false, reason: "missing-secret" });
    expect(verify).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips with a loud warning outside production when the secret is missing", async () => {
    const { verifyRecaptcha, verify, warn } = setup({ getSecret: () => undefined });
    expect(await verifyRecaptcha("tok")).toEqual({
      success: true,
      skipped: true,
      reason: "missing-secret-in-development",
    });
    expect(verify).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SKIPPED"));
  });

  it("turns a gateway error into request-failed instead of throwing", async () => {
    const { verifyRecaptcha } = setup({
      gateway: { verify: jest.fn().mockRejectedValue(new Error("network down")) },
    });
    expect(await verifyRecaptcha("tok")).toEqual({ success: false, reason: "request-failed" });
  });

  it("applies the rules to the Google response", async () => {
    const { verifyRecaptcha } = setup();
    expect(await verifyRecaptcha("tok", { expectedAction: "signup" })).toMatchObject({
      reason: "action-mismatch",
    });
  });
});
