/** @jest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { RecaptchaField } from "../presentation/RecaptchaField";
import type { Grecaptcha } from "../infrastructure/scriptLoader";

const scripts = () => document.head.querySelectorAll('script[src*="recaptcha/api.js"]');
const hiddenInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[name="g-recaptcha-response"]');

let execute: jest.Mock;
let counter = 0;
let site = "";

/** Plays the part of Google: the script tag "loads" and grecaptcha appears. */
async function finishScriptLoad() {
  await waitFor(() => expect(scripts()).toHaveLength(1));
  await act(async () => {
    const api: Grecaptcha = { ready: (cb) => cb(), execute: execute as Grecaptcha["execute"] };
    window.grecaptcha = api;
    scripts()[0]?.dispatchEvent(new Event("load"));
  });
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed: Element[] = [];
  constructor(private callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  show() {
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
  }
}

beforeEach(() => {
  site = `site-${++counter}`;
  execute = jest.fn().mockResolvedValue("token-1");
  FakeIntersectionObserver.instances = [];
});

afterEach(() => {
  jest.useRealTimers();
  document.head.innerHTML = "";
  delete window.grecaptcha;
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe("RecaptchaField", () => {
  it("renders nothing without a site key", () => {
    const { container } = render(<RecaptchaField action="login" />);
    expect(container.innerHTML).toBe("");
    expect(scripts()).toHaveLength(0);
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

  it("refreshes the token on the interval", async () => {
    execute.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
    jest.useFakeTimers();
    const { container } = render(
      <RecaptchaField action="a" siteKey={site} refreshIntervalMs={1000} />,
    );
    await finishScriptLoad();
    await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-2"));
  });

  describe("after a submit", () => {
    it("asks for a new token and puts it in the hidden input", async () => {
      execute.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
      const { container } = render(
        <form>
          <RecaptchaField action="contact" siteKey={site} />
        </form>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));

      await act(async () => {
        container.querySelector("form")?.dispatchEvent(new Event("submit"));
      });

      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-2"));
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("asks once for a submit that fires both submit and formdata", async () => {
      execute.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
      const { container } = render(
        <form>
          <RecaptchaField action="contact" siteKey={site} />
        </form>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));

      const form = container.querySelector("form");
      await act(async () => {
        form?.dispatchEvent(new Event("submit"));
        form?.dispatchEvent(new Event("formdata"));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-2"));
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("keeps the timer only when the field is not inside a form", async () => {
      jest.useFakeTimers();
      execute.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
      const { container } = render(
        <RecaptchaField action="a" siteKey={site} refreshIntervalMs={1000} />,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));

      // A submit on some other form must not renew this field.
      const other = document.createElement("form");
      document.body.appendChild(other);
      await act(async () => {
        other.dispatchEvent(new Event("submit"));
        await Promise.resolve();
      });
      other.remove();
      expect(execute).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-2"));
    });
  });

  describe("every submit path", () => {
    /** Mounts the field in a form with a fresh token per call: token-1, token-2, ... */
    async function mountInForm() {
      let issued = 0;
      execute.mockImplementation(async () => `token-${++issued}`);
      const utils = render(
        <form>
          <RecaptchaField action="contact" siteKey={site} />
          <button type="submit">Send</button>
        </form>,
      );
      const form = utils.container.querySelector("form") as HTMLFormElement;
      // Stop jsdom from trying to navigate. A canceled submit also skips its "not implemented" log.
      form.addEventListener("submit", (event) => event.preventDefault());
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(utils.container)?.value).toBe("token-1"));
      return { ...utils, form, value: () => hiddenInput(utils.container)?.value };
    }

    /** Lets the renewal, scheduled with a timeout of 0, and any follow-up run. */
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

    const fire = (target: EventTarget, type: string) =>
      act(async () => {
        target.dispatchEvent(new Event(type, { cancelable: true }));
      });

    it("(a) a click on a submit button renews once, after submit and formdata", async () => {
      const { form, value, getByRole } = await mountInForm();

      await act(async () => {
        getByRole("button", { name: "Send" }).click();
      });
      // jsdom fires submit on a click but not formdata, so formdata is sent here in the browser's order.
      await fire(form, "formdata");
      await waitFor(() => expect(value()).toBe("token-2"));
      await settle();

      expect(execute).toHaveBeenCalledTimes(2);
      expect(value()).toBe("token-2");
    });

    it("(b) form.requestSubmit() renews once, after submit and formdata", async () => {
      const { form, value } = await mountInForm();

      await act(async () => form.requestSubmit());
      await fire(form, "formdata");
      await waitFor(() => expect(value()).toBe("token-2"));
      await settle();

      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("(c) form.submit() fires only formdata and still renews once", async () => {
      const { form, value } = await mountInForm();

      await fire(form, "formdata");
      await waitFor(() => expect(value()).toBe("token-2"));
      await settle();

      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("(d) a Server Action style submit with only formdata renews once, and the new token is in the next FormData", async () => {
      const { form, value } = await mountInForm();

      // A Server Action reads the FormData carried by the formdata event.
      const formData = new FormData(form);
      await act(async () => {
        form.dispatchEvent(Object.assign(new Event("formdata"), { formData }));
      });
      await waitFor(() => expect(value()).toBe("token-2"));
      await settle();

      expect(execute).toHaveBeenCalledTimes(2);
      expect(new FormData(form).get("g-recaptcha-response")).toBe("token-2");
    });

    it("(e) two submits one after the other renew once each", async () => {
      const { form, value } = await mountInForm();

      await fire(form, "submit");
      await fire(form, "formdata");
      await waitFor(() => expect(value()).toBe("token-2"));
      await settle();

      await fire(form, "submit");
      await fire(form, "formdata");
      await waitFor(() => expect(value()).toBe("token-3"));
      await settle();

      expect(execute).toHaveBeenCalledTimes(3);
    });

    it("(f) a submit while a renewal is in flight asks for one more token afterwards", async () => {
      const { form, value } = await mountInForm();
      // The first submit's renewal stays pending until the test resolves it.
      let resolveSecond!: (token: string) => void;
      execute
        .mockImplementationOnce(() => new Promise<string>((resolve) => (resolveSecond = resolve)))
        .mockImplementationOnce(async () => "token-3");

      await fire(form, "submit");
      await fire(form, "formdata");
      await settle();
      expect(execute).toHaveBeenCalledTimes(2);

      // A second submit arrives while that request is still open.
      await fire(form, "submit");
      await fire(form, "formdata");
      await settle();
      expect(execute).toHaveBeenCalledTimes(2);

      await act(async () => resolveSecond("token-2"));
      await waitFor(() => expect(value()).toBe("token-3"));
      await settle();

      expect(execute).toHaveBeenCalledTimes(3);
      expect(value()).toBe("token-3");
    });

    it("(g) a submit of another form on the page does not renew", async () => {
      let issued = 0;
      execute.mockImplementation(async () => `token-${++issued}`);
      const { container } = render(
        <>
          <form data-testid="field-form">
            <RecaptchaField action="contact" siteKey={site} />
          </form>
          <form data-testid="other-form">
            <button type="submit">Other</button>
          </form>
        </>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));

      const other = screen.getByTestId("other-form");
      await fire(other, "submit");
      await fire(other, "formdata");
      await settle();

      expect(execute).toHaveBeenCalledTimes(1);
      expect(hiddenInput(container)?.value).toBe("token-1");
    });

    it("(h) removes its submit and formdata listeners on unmount", async () => {
      // A submit after unmount does not renew even if a handler were left behind, because the
      // hook's execute is cleared too. So the test checks the listeners themselves.
      const add = jest.spyOn(HTMLFormElement.prototype, "addEventListener");
      const remove = jest.spyOn(HTMLFormElement.prototype, "removeEventListener");
      try {
        const { container, unmount } = render(
          <form>
            <RecaptchaField action="contact" siteKey={site} />
          </form>,
        );
        await finishScriptLoad();
        await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));

        const added = add.mock.calls.filter(([type]) => type === "submit" || type === "formdata");
        expect(added).toHaveLength(2);
        unmount();
        for (const [type, handler] of added) {
          expect(remove).toHaveBeenCalledWith(type, handler);
        }
      } finally {
        add.mockRestore();
        remove.mockRestore();
      }
    });
  });

  it("calls onError when the script fails to load", async () => {
    const onError = jest.fn();
    render(<RecaptchaField action="a" siteKey={site} onError={onError} />);
    await waitFor(() => expect(scripts()).toHaveLength(1));
    await act(async () => {
      scripts()[0]?.dispatchEvent(new Event("error"));
    });
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(new Error("Failed to load reCAPTCHA script")),
    );
  });

  it("calls onError when making a token fails", async () => {
    execute.mockRejectedValue(new Error("boom"));
    const onError = jest.fn();
    render(<RecaptchaField action="a" siteKey={site} onError={onError} />);
    await finishScriptLoad();
    await waitFor(() => expect(onError).toHaveBeenCalledWith(new Error("boom")));
  });

  it("does not restart token generation when callback props change identity", async () => {
    function Host() {
      const [count, setCount] = useState(0);
      return (
        <>
          <button onClick={() => setCount(count + 1)}>rerender</button>
          <RecaptchaField
            action="a"
            siteKey={site}
            onTokenGenerated={() => void count}
            onError={() => void count}
          />
        </>
      );
    }
    const { container } = render(<Host />);
    await finishScriptLoad();
    await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));

    for (let i = 0; i < 3; i++) {
      await act(async () => screen.getByText("rerender").click());
    }
    expect(execute).toHaveBeenCalledTimes(1);
    expect(scripts()).toHaveLength(1);
  });

  describe("when action or siteKey changes while a request is in flight", () => {
    let issued = 0;

    /** Each token names its action and the call number, so a stale one is easy to spot. */
    const tokensNamedByAction = () => {
      issued = 0;
      execute.mockImplementation(
        async (_key: string, options: { action: string }) => `token-${options.action}-${++issued}`,
      );
    };

    /** Plays Google for a second site key, whose script is a separate tag. */
    async function finishScriptLoadFor(key: string) {
      await waitFor(() =>
        expect(
          document.head.querySelector(`script[src*="render=${encodeURIComponent(key)}"]`),
        ).not.toBeNull(),
      );
      await act(async () => {
        const api: Grecaptcha = { ready: (cb) => cb(), execute: execute as Grecaptcha["execute"] };
        window.grecaptcha = api;
        document.head
          .querySelector(`script[src*="render=${encodeURIComponent(key)}"]`)
          ?.dispatchEvent(new Event("load"));
      });
    }

    const fire = (target: EventTarget, type: string) =>
      act(async () => {
        target.dispatchEvent(new Event(type, { cancelable: true }));
      });

    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

    /** A form that holds the field, so a submit can start a renewal that stays in flight. */
    const formWith = (action: string, key: string) => (
      <form>
        <RecaptchaField action={action} siteKey={key} />
      </form>
    );

    /** Makes the next execute call wait until the test resolves it. */
    function holdNextCall() {
      let resolve!: (token: string) => void;
      execute.mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      );
      return (token: string) => resolve(token);
    }

    it("(a) gets a token made with the new action, not the one in flight", async () => {
      tokensNamedByAction();
      const { container, rerender } = render(formWith("login", site));
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toMatch(/^token-login-/));

      const resolveStale = holdNextCall();
      const form = container.querySelector("form") as HTMLFormElement;
      await fire(form, "submit");
      await fire(form, "formdata");
      await settle();
      expect(execute).toHaveBeenLastCalledWith(site, { action: "login" });

      rerender(formWith("checkout", site));
      await waitFor(() => expect(hiddenInput(container)?.value).toMatch(/^token-checkout-/));
      expect(execute).toHaveBeenLastCalledWith(site, { action: "checkout" });

      // The old request finishes late. Its token is for "login" and must not land in the field.
      await act(async () => resolveStale("token-login-stale"));
      await settle();
      expect(hiddenInput(container)?.value).toMatch(/^token-checkout-/);
    });

    it("(b) gets a token made with the new site key, not the one in flight", async () => {
      const otherSite = `${site}-other`;
      tokensNamedByAction();
      const { container, rerender } = render(formWith("login", site));
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toMatch(/^token-login-/));

      const resolveStale = holdNextCall();
      const form = container.querySelector("form") as HTMLFormElement;
      await fire(form, "submit");
      await fire(form, "formdata");
      await settle();

      rerender(formWith("login", otherSite));
      await finishScriptLoadFor(otherSite);
      await waitFor(() => expect(hiddenInput(container)?.value).toMatch(/^token-login-/));
      expect(execute).toHaveBeenLastCalledWith(otherSite, { action: "login" });
      const fresh = hiddenInput(container)?.value;

      await act(async () => resolveStale("token-stale-old-key"));
      await settle();
      expect(hiddenInput(container)?.value).toBe(fresh);
    });

    it("(c) never exposes the old action's token while the new one is pending", async () => {
      tokensNamedByAction();
      const { container, rerender } = render(formWith("login", site));
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toMatch(/^token-login-/));

      // The new action's token takes a while, so a submit lands in that gap.
      let resolveNew!: (token: string) => void;
      execute.mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            resolveNew = done;
          }),
      );
      rerender(formWith("checkout", site));
      await settle();

      expect(hiddenInput(container)?.value).not.toMatch(/^token-login-/);
      const form = container.querySelector("form") as HTMLFormElement;
      expect(new FormData(form).get("g-recaptcha-response")).not.toMatch(/^token-login-/);

      await act(async () => resolveNew("token-checkout-new"));
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-checkout-new"));
    });

    it("(c) a submit after the new action's token arrives sends a token for that action", async () => {
      tokensNamedByAction();
      const { container, rerender } = render(formWith("login", site));
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toMatch(/^token-login-/));

      rerender(formWith("checkout", site));
      await waitFor(() => expect(hiddenInput(container)?.value).toMatch(/^token-checkout-/));

      const form = container.querySelector("form") as HTMLFormElement;
      await fire(form, "submit");
      await fire(form, "formdata");
      await waitFor(() => expect(hiddenInput(container)?.value).toMatch(/^token-checkout-/));
      await settle();
      expect(execute).toHaveBeenLastCalledWith(site, { action: "checkout" });
      expect(new FormData(form).get("g-recaptcha-response")).toMatch(/^token-checkout-/);
    });

    it("(d) an old request that resolves after the change does not overwrite the new token", async () => {
      tokensNamedByAction();
      const onTokenGenerated = jest.fn();
      const { container, rerender } = render(
        <form>
          <RecaptchaField action="login" siteKey={site} onTokenGenerated={onTokenGenerated} />
        </form>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toMatch(/^token-login-/));
      const resolveStale = holdNextCall();
      const form = container.querySelector("form") as HTMLFormElement;
      await fire(form, "submit");
      await fire(form, "formdata");
      await settle();

      rerender(
        <form>
          <RecaptchaField action="checkout" siteKey={site} onTokenGenerated={onTokenGenerated} />
        </form>,
      );
      await waitFor(() => expect(hiddenInput(container)?.value).toMatch(/^token-checkout-/));
      const newToken = hiddenInput(container)?.value;

      await act(async () => resolveStale("token-login-stale"));
      await settle();

      expect(hiddenInput(container)?.value).toBe(newToken);
      expect(onTokenGenerated).not.toHaveBeenCalledWith("token-login-stale");
      expect(onTokenGenerated).toHaveBeenLastCalledWith(newToken);
    });
  });

  describe("lazy mode", () => {
    it("loads nothing until the form becomes visible, then produces a token", async () => {
      (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
        FakeIntersectionObserver;
      const { container } = render(
        <form>
          <RecaptchaField action="a" siteKey={site} lazy lazyRootMargin="50px" />
        </form>,
      );
      expect(scripts()).toHaveLength(0);
      expect(FakeIntersectionObserver.instances[0]?.observed[0]).toBe(
        container.querySelector("form"),
      );

      await act(async () => FakeIntersectionObserver.instances[0]?.show());
      await finishScriptLoad();

      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
    });

    it("falls back to eager loading when IntersectionObserver does not exist", async () => {
      const { container } = render(<RecaptchaField action="a" siteKey={site} lazy />);
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
    });
  });
});
