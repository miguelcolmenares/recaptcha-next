/** @jest-environment jsdom */
import { render, waitFor } from "@testing-library/react";
import { RecaptchaField } from "@/presentation";
import {
  scripts,
  hiddenInput,
  execute,
  site,
  finishScriptLoad,
} from "@/presentation/__tests__/field-fixture";

describe("RecaptchaField", () => {
  it("renders nothing without a site key", () => {
    const saved = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
    delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
    try {
      const { container } = render(<RecaptchaField action="login" />);
      expect(container.innerHTML).toBe("");
      expect(scripts()).toHaveLength(0);
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
      else process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = saved;
    }
  });

  it("fills the hidden input with a token and reports it", async () => {
    const onTokenGenerated = jest.fn();
    const { container } = render(
      <RecaptchaField action="login" siteKey={site} onTokenGenerated={onTokenGenerated} />,
    );
    await finishScriptLoad();

    await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
    expect(execute).toHaveBeenCalledWith(site, { action: "login" });
    expect(onTokenGenerated).toHaveBeenCalledWith("token-1");
  });

  it("uses a custom input name", async () => {
    const { container } = render(<RecaptchaField action="a" siteKey={site} name="captcha" />);
    await finishScriptLoad();
    await waitFor(() =>
      expect(container.querySelector<HTMLInputElement>('input[name="captcha"]')?.value).toBe(
        "token-1",
      ),
    );
  });
});
