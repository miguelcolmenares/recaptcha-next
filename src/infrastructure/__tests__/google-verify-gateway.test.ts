import { createGoogleVerifyGateway } from "@/infrastructure/google-verify-gateway";

describe("createGoogleVerifyGateway", () => {
  it("posts a form-encoded body to the verify URL", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, score: 0.7 }),
    });
    const gateway = createGoogleVerifyGateway({ fetchImpl, url: "https://verify.test/x" });

    const body = await gateway.verify({ secret: "s", token: "t", remoteIp: "9.9.9.9" });

    expect(body).toEqual({ success: true, score: 0.7 });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://verify.test/x");
    expect(init.method).toBe("POST");
    expect((init.body as URLSearchParams).toString()).toBe("secret=s&response=t&remoteip=9.9.9.9");
  });

  it("omits remoteip when not given", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    await createGoogleVerifyGateway({ fetchImpl }).verify({ secret: "s", token: "t" });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.body as URLSearchParams).has("remoteip")).toBe(false);
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(
      createGoogleVerifyGateway({ fetchImpl }).verify({ secret: "s", token: "t" }),
    ).rejects.toThrow("503");
  });
});
