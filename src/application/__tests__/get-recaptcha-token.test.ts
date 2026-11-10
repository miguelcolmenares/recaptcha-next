import { getRecaptchaToken } from "@/application/get-recaptcha-token";

describe("getRecaptchaToken", () => {
  it("reads the default field", () => {
    const form = new FormData();
    form.set("g-recaptcha-response", "abc");
    expect(getRecaptchaToken(form)).toBe("abc");
  });

  it("reads a custom field", () => {
    const form = new FormData();
    form.set("token", "xyz");
    expect(getRecaptchaToken(form, "token")).toBe("xyz");
  });

  it("returns null when the field is missing, as with custom FormData", () => {
    expect(getRecaptchaToken(new FormData())).toBeNull();
  });

  it("returns null for an empty value or a file", () => {
    const form = new FormData();
    form.set("g-recaptcha-response", "");
    expect(getRecaptchaToken(form)).toBeNull();
    form.set("g-recaptcha-response", new Blob(["x"]), "x.txt");
    expect(getRecaptchaToken(form)).toBeNull();
  });
});
