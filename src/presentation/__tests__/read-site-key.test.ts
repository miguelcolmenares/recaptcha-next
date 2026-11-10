import { readSiteKey } from "@/presentation/read-site-key";

const original = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  else process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = original;
});

describe("site key lookup", () => {
  it("reads the configured public key", () => {
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = "public-site";
    expect(readSiteKey()).toBe("public-site");
  });

  it.each([undefined, ""])("treats %p as unconfigured", (value) => {
    if (value === undefined) delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
    else process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = value;
    expect(readSiteKey()).toBeUndefined();
  });
});
