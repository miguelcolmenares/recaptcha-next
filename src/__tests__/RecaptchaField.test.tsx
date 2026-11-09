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

/** Plays Google for a site key other than the first, whose script is a separate tag. */
async function finishScriptLoadFor(key: string) {
  const selector = `script[src*="render=${encodeURIComponent(key)}"]`;
  await waitFor(() => expect(document.head.querySelector(selector)).not.toBeNull());
  await act(async () => {
    const api: Grecaptcha = { ready: (cb) => cb(), execute: execute as Grecaptcha["execute"] };
    window.grecaptcha = api;
    document.head.querySelector(selector)?.dispatchEvent(new Event("load"));
  });
}

/** Lets the promises started by the last step settle, and the effects they cause run. */
const tick = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

/** Lets a renewal scheduled with a timeout of 0, and any follow-up, run with real timers. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

/**
 * Moves fake time forward by `ms`, then lets what that step started settle. Advance to the
 * exact moment of a timer, not past it, so a retry is scheduled from that moment.
 */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await tick();
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

  describe("the token inside onTokenGenerated", () => {
    /** What a consumer that submits from the callback reads: the form's data, at that moment. */
    const readToken = (form: HTMLFormElement | null) =>
      form ? new FormData(form).get("g-recaptcha-response") : undefined;

    it("is already in the form's data for the first token", async () => {
      const seen: unknown[] = [];
      const { container } = render(
        <form>
          <RecaptchaField
            action="a"
            siteKey={site}
            onTokenGenerated={() => seen.push(readToken(container.querySelector("form")))}
          />
        </form>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));

      expect(seen).toEqual(["token-1"]);
    });

    it("is already in the form's data for a refresh, not the previous token", async () => {
      execute.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
      jest.useFakeTimers();
      const seen: Array<[string, unknown]> = [];
      const { container } = render(
        <form>
          <RecaptchaField
            action="a"
            siteKey={site}
            refreshIntervalMs={1000}
            onTokenGenerated={(token) =>
              seen.push([token, readToken(container.querySelector("form"))])
            }
          />
        </form>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
      await advance(1000);
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-2"));

      expect(seen).toEqual([
        ["token-1", "token-1"],
        ["token-2", "token-2"],
      ]);
    });

    it("is already in the form's data when the callback submits the form", async () => {
      const sent: unknown[] = [];
      const { container } = render(
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sent.push(readToken(event.currentTarget));
          }}
        >
          <RecaptchaField
            action="a"
            siteKey={site}
            onTokenGenerated={() => container.querySelector("form")?.requestSubmit()}
          />
        </form>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));

      expect(sent).toEqual(["token-1"]);
    });

    it("leaves the input holding the token after the render, so React does not fight the write", async () => {
      const { container } = render(
        <form>
          <RecaptchaField action="a" siteKey={site} />
        </form>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
      await tick();

      expect(hiddenInput(container)?.value).toBe("token-1");
      expect(hiddenInput(container)?.getAttribute("value")).toBe("token-1");
    });
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

      // The browser fires formdata when it builds the form data for a submit.
      await act(async () => {
        container
          .querySelector("form")
          ?.dispatchEvent(Object.assign(new Event("formdata"), { formData: new FormData() }));
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

    it("a field outside a form ignores the submits of other forms and renews on its timer", async () => {
      jest.useFakeTimers();
      execute.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
      const { container } = render(
        <RecaptchaField action="a" siteKey={site} refreshIntervalMs={1000} />,
      );
      await finishScriptLoad();
      await tick();
      expect(hiddenInput(container)?.value).toBe("token-1");

      // A field that wrongly listened to this form would schedule its renewal with a timeout of
      // 0. Advancing the clock past that timeout (but not the 1000 ms refresh) makes it run.
      const other = document.createElement("form");
      document.body.appendChild(other);
      await act(async () => {
        other.dispatchEvent(
          Object.assign(new Event("formdata", { bubbles: true }), { formData: new FormData() }),
        );
      });
      await act(async () => {
        jest.advanceTimersByTime(20);
      });
      other.remove();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(hiddenInput(container)?.value).toBe("token-1");

      await advance(980);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(hiddenInput(container)?.value).toBe("token-2");
    });

    it("a canceled submit (validation) neither clears nor renews the token", async () => {
      execute.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
      const { container } = render(
        <form>
          <RecaptchaField action="contact" siteKey={site} />
        </form>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
      const form = container.querySelector("form") as HTMLFormElement;
      // Validation cancels the submit, so the browser never builds the form data.
      form.addEventListener("submit", (event) => event.preventDefault());

      let event!: Event;
      await act(async () => {
        event = new Event("submit", { cancelable: true });
        form.dispatchEvent(event);
      });
      await settle();

      expect(event.defaultPrevented).toBe(true);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(hiddenInput(container)?.value).toBe("token-1");
    });

    it("an async onSubmit that builds FormData after an await still carries the token", async () => {
      execute.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
      const { container } = render(
        <form>
          <RecaptchaField action="contact" siteKey={site} />
        </form>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
      const form = container.querySelector("form") as HTMLFormElement;

      // The page cancels the submit, waits for longer than a task, then reads the form.
      let built!: FormData;
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await new Promise((resolve) => setTimeout(resolve, 20));
        built = new FormData(form);
        // A browser fires formdata when the form data is built, which renews the token.
        form.dispatchEvent(Object.assign(new Event("formdata"), { formData: built }));
      });
      await act(async () => {
        form.dispatchEvent(new Event("submit", { cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 40));
      });

      expect(built.get("g-recaptcha-response")).toBe("token-1");
      await settle();
      expect(hiddenInput(container)?.value).toBe("token-2");
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

        // Only formdata: a submit that is canceled builds no form data, so it renews nothing.
        const added = add.mock.calls.filter(([type]) => type === "submit" || type === "formdata");
        expect(added.map(([type]) => type)).toEqual(["formdata"]);
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

  describe("the spent token after a submit", () => {
    /** Mounts a field in a form with token-1. The next renewal is held until the test resolves it. */
    async function mountWithHeldRenewal() {
      const onError = jest.fn();
      const utils = render(
        <form>
          <RecaptchaField action="contact" siteKey={site} onError={onError} />
        </form>,
      );
      const form = utils.container.querySelector("form") as HTMLFormElement;
      execute.mockResolvedValueOnce("token-1");
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(utils.container)?.value).toBe("token-1"));

      let resolveRenewal!: (token: string) => void;
      let rejectRenewal!: (cause: Error) => void;
      execute.mockImplementationOnce(
        () =>
          new Promise<string>((resolve, reject) => {
            resolveRenewal = resolve;
            rejectRenewal = reject;
          }),
      );
      const value = () => hiddenInput(utils.container)?.value;
      return {
        ...utils,
        form,
        onError,
        value,
        resolveRenewal: (token: string) => resolveRenewal(token),
        rejectRenewal: (cause: Error) => rejectRenewal(cause),
      };
    }

    /** A submit as the browser runs it: submit, then FormData is built, then formdata. */
    async function submitForm(form: HTMLFormElement) {
      let formData!: FormData;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { cancelable: true }));
        formData = new FormData(form);
        form.dispatchEvent(Object.assign(new Event("formdata"), { formData }));
      });
      return formData;
    }

    /** Lets the renewal, scheduled with a timeout of 0, start. */
    it("(a) while the renewal is pending, the hidden input and FormData carry no token", async () => {
      const { form, value } = await mountWithHeldRenewal();

      await submitForm(form);
      await settle();

      expect(execute).toHaveBeenCalledTimes(2);
      expect(value()).toBe("");
      expect(new FormData(form).get("g-recaptcha-response")).toBe("");
    });

    it("(b) a retry while the renewal is pending sends no spent token", async () => {
      const { form, value, resolveRenewal } = await mountWithHeldRenewal();
      await submitForm(form);
      await settle();

      const retry = await submitForm(form);
      await settle();

      expect(retry.get("g-recaptcha-response")).toBe("");
      expect(value()).toBe("");
      // The retry asked for one more token, which comes after the held one.
      execute.mockResolvedValueOnce("token-3");
      await act(async () => resolveRenewal("token-2"));
      await waitFor(() => expect(value()).toBe("token-3"));
    });

    it("(c) when the renewal rejects, the field stays empty and onError is called", async () => {
      const { form, value, onError, rejectRenewal } = await mountWithHeldRenewal();
      const failure = new Error("network down");

      await submitForm(form);
      await settle();
      await act(async () => rejectRenewal(failure));
      await settle();

      expect(onError).toHaveBeenCalledWith(failure);
      expect(value()).toBe("");
      expect(new FormData(form).get("g-recaptcha-response")).toBe("");
    });

    it("(d) the submission that triggered the renewal still carried its token", async () => {
      const { form, value, resolveRenewal } = await mountWithHeldRenewal();

      const formData = await submitForm(form);

      expect(formData.get("g-recaptcha-response")).toBe("token-1");
      await settle();
      await act(async () => resolveRenewal("token-2"));
      await waitFor(() => expect(value()).toBe("token-2"));
    });

    it("(e) a renewal in flight that resolves after formdata keeps its new token", async () => {
      jest.useFakeTimers();
      const utils = render(
        <form>
          <RecaptchaField action="contact" siteKey={site} refreshIntervalMs={1000} />
        </form>,
      );
      const form = utils.container.querySelector("form") as HTMLFormElement;
      const value = () => hiddenInput(utils.container)?.value;
      execute.mockResolvedValueOnce("token-1");
      await finishScriptLoad();
      await tick();
      expect(value()).toBe("token-1");

      // The timer starts a renewal, and the answer is held.
      let resolveTimerRenewal!: (token: string) => void;
      execute.mockImplementationOnce(
        () => new Promise<string>((resolve) => (resolveTimerRenewal = resolve)),
      );
      await advance(1000);
      expect(execute).toHaveBeenCalledTimes(2);

      // The form is read while that renewal is in flight. token-1 is what it serialized.
      let formData!: FormData;
      await act(async () => {
        formData = new FormData(form);
        form.dispatchEvent(Object.assign(new Event("formdata"), { formData }));
      });
      expect(formData.get("g-recaptcha-response")).toBe("token-1");

      // The renewal answers after formdata, before the zero-delay task of that submit.
      await act(async () => resolveTimerRenewal("token-2"));
      await tick();
      expect(value()).toBe("token-2");

      // The zero-delay task runs and starts one more request, held here. token-2 was never
      // serialized, so it stays in the field, and a retry sends it, while that request is pending.
      execute.mockImplementationOnce(() => new Promise<string>(() => {}));
      await advance(0);
      expect(execute).toHaveBeenCalledTimes(3);
      expect(value()).toBe("token-2");
    });
  });

  describe("token failures, expiry and the timeout", () => {
    /** Mounts a loaded field on fake timers. Its first token is already in the field. */
    async function mountLoaded(refreshIntervalMs?: number) {
      jest.useFakeTimers();
      const onError = jest.fn();
      const utils = render(
        <RecaptchaField
          action="a"
          siteKey={site}
          refreshIntervalMs={refreshIntervalMs}
          onError={onError}
        />,
      );
      await finishScriptLoad();
      await tick();
      return { ...utils, onError, value: () => hiddenInput(utils.container)?.value };
    }

    it("retries a failed first token after 5 seconds, and the field fills in", async () => {
      execute.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("token-2");
      const { onError, value } = await mountLoaded(1000);

      expect(onError).toHaveBeenCalledWith(new Error("boom"));
      expect(value()).toBe("");

      await advance(4999);
      expect(execute).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(value()).toBe("token-2");
    });

    it("backs off 5, 10, 20 and then 30 seconds, and reports each failure", async () => {
      execute.mockRejectedValue(new Error("down"));
      const { onError } = await mountLoaded(1000);
      expect(execute).toHaveBeenCalledTimes(1);

      await advance(4999);
      expect(execute).toHaveBeenCalledTimes(1);
      await advance(1); // 5 s
      expect(execute).toHaveBeenCalledTimes(2);

      await advance(9999);
      expect(execute).toHaveBeenCalledTimes(2);
      await advance(1); // 10 s later
      expect(execute).toHaveBeenCalledTimes(3);

      await advance(19999);
      expect(execute).toHaveBeenCalledTimes(3);
      await advance(1); // 20 s later
      expect(execute).toHaveBeenCalledTimes(4);

      await advance(29999);
      expect(execute).toHaveBeenCalledTimes(4);
      await advance(1); // 30 s, the cap
      expect(execute).toHaveBeenCalledTimes(5);

      await advance(29999);
      expect(execute).toHaveBeenCalledTimes(5);
      await advance(1); // still 30 s
      expect(execute).toHaveBeenCalledTimes(6);
      expect(onError).toHaveBeenCalledTimes(6);
    });

    it("resets the backoff after a successful retry", async () => {
      execute
        .mockResolvedValueOnce("token-1")
        .mockRejectedValueOnce(new Error("x"))
        .mockResolvedValueOnce("token-2")
        .mockRejectedValueOnce(new Error("y"))
        .mockResolvedValueOnce("token-3");
      const { value } = await mountLoaded(1000);

      await advance(1000); // renewal fails, retry in 5 s
      await advance(5000); // retry succeeds, next renewal in 1 s
      expect(value()).toBe("token-2");
      await advance(1000); // renewal fails, and the backoff starts again at 5 s
      expect(execute).toHaveBeenCalledTimes(4);
      await advance(4999);
      expect(execute).toHaveBeenCalledTimes(4);
      await advance(1);
      expect(execute).toHaveBeenCalledTimes(5);
      expect(value()).toBe("token-3");
    });

    it("clears the token when its two minutes pass, even while renewals keep failing", async () => {
      execute.mockResolvedValueOnce("token-1").mockRejectedValue(new Error("offline"));
      const { onError, value } = await mountLoaded();
      expect(value()).toBe("token-1");

      await advance(90_000); // first renewal fails
      await advance(5_000); // retry
      await advance(10_000); // retry
      expect(onError).toHaveBeenCalledTimes(3);
      expect(value()).toBe("token-1");

      await advance(14_999); // 119.999 s after the token was issued
      expect(value()).toBe("token-1");
      await advance(1); // 120 s: the TTL has passed
      expect(value()).toBe("");
    });

    it("gives up on a token request that never settles, so the next one can start", async () => {
      execute
        .mockResolvedValueOnce("token-1")
        .mockImplementationOnce(() => new Promise<string>(() => {}))
        .mockResolvedValueOnce("token-3");
      const { onError, value } = await mountLoaded(1000);

      await advance(1000); // the request starts and never answers
      expect(execute).toHaveBeenCalledTimes(2);
      await advance(9999);
      expect(onError).not.toHaveBeenCalled();
      await advance(1); // 10 s
      expect(onError).toHaveBeenCalledWith(new Error("reCAPTCHA did not answer within 10 seconds"));

      await advance(4999);
      expect(execute).toHaveBeenCalledTimes(2);
      await advance(1); // 5 s retry
      expect(execute).toHaveBeenCalledTimes(3);
      expect(value()).toBe("token-3");
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

    const fire = (target: EventTarget, type: string) =>
      act(async () => {
        target.dispatchEvent(new Event(type, { cancelable: true }));
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

  describe("execute call count", () => {
    let issued = 0;

    /** Every call gets a new token, so a change in the field shows which call produced it. */
    beforeEach(() => {
      issued = 0;
      execute.mockImplementation(async () => `token-${++issued}`);
    });

    const fire = (target: EventTarget, type: string) =>
      act(async () => {
        target.dispatchEvent(new Event(type, { cancelable: true }));
      });

    it("(a) first mount calls execute exactly once", async () => {
      const { container } = render(<RecaptchaField action="login" siteKey={site} />);
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
      await settle();

      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("(b) an action change on a loaded field calls execute exactly once more", async () => {
      const { container, rerender } = render(<RecaptchaField action="login" siteKey={site} />);
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
      await settle();
      expect(execute).toHaveBeenCalledTimes(1);

      rerender(<RecaptchaField action="checkout" siteKey={site} />);
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-2"));
      await settle();

      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenLastCalledWith(site, { action: "checkout" });
    });

    it("(c) a siteKey change on a loaded field calls execute exactly once more", async () => {
      const otherSite = `${site}-other`;
      const { container, rerender } = render(<RecaptchaField action="login" siteKey={site} />);
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
      await settle();
      expect(execute).toHaveBeenCalledTimes(1);

      rerender(<RecaptchaField action="login" siteKey={otherSite} />);
      await finishScriptLoadFor(otherSite);
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-2"));
      await settle();

      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenLastCalledWith(otherSite, { action: "login" });
    });

    it("(d) a submit calls execute exactly once more", async () => {
      const { container } = render(
        <form>
          <RecaptchaField action="contact" siteKey={site} />
        </form>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
      await settle();
      expect(execute).toHaveBeenCalledTimes(1);

      const form = container.querySelector("form") as HTMLFormElement;
      form.addEventListener("submit", (event) => event.preventDefault());
      await fire(form, "submit");
      await fire(form, "formdata");
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-2"));
      await settle();

      expect(execute).toHaveBeenCalledTimes(2);
    });
  });

  describe("while the script is still loading", () => {
    /** The token names the site key it was made for, so a stale one is easy to spot. */
    beforeEach(() => {
      execute.mockImplementation(async (key: string) => `token-for-${key}`);
    });

    /** Mounts with the first key, and waits until its script tag is in the page, still loading. */
    async function mountWhileLoading(siteA: string, refreshIntervalMs?: number) {
      const utils = render(
        <RecaptchaField action="login" siteKey={siteA} refreshIntervalMs={refreshIntervalMs} />,
      );
      await waitFor(() =>
        expect(document.head.querySelector(`script[src*="render=${siteA}"]`)).not.toBeNull(),
      );
      return utils;
    }

    it("(a) a siteKey change before the first script loads uses the new key, and drops the old load", async () => {
      const siteB = `${site}-other`;
      const { container, rerender } = await mountWhileLoading(site);
      expect(execute).not.toHaveBeenCalled();

      rerender(<RecaptchaField action="login" siteKey={siteB} />);
      // Google answers for the old key first. Nothing may use that result.
      await finishScriptLoadFor(site);
      await tick();
      expect(execute).not.toHaveBeenCalled();
      expect(hiddenInput(container)?.value).toBe("");

      await finishScriptLoadFor(siteB);
      await waitFor(() => expect(hiddenInput(container)?.value).toBe(`token-for-${siteB}`));
      await settle();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(siteB, { action: "login" });
    });

    it("(a) the old key's load that finishes last does not change the new key's token", async () => {
      const siteB = `${site}-other`;
      const { container, rerender } = await mountWhileLoading(site);

      rerender(<RecaptchaField action="login" siteKey={siteB} />);
      await finishScriptLoadFor(siteB);
      await waitFor(() => expect(hiddenInput(container)?.value).toBe(`token-for-${siteB}`));

      await finishScriptLoadFor(site);
      await settle();
      expect(hiddenInput(container)?.value).toBe(`token-for-${siteB}`);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).not.toHaveBeenCalledWith(site, expect.anything());
    });

    it("(a) the old key's script that fails after the change reports no error and leaves the new key alone", async () => {
      const siteB = `${site}-other`;
      const onError = jest.fn();
      const { container, rerender } = await mountWhileLoading(site);

      rerender(<RecaptchaField action="login" siteKey={siteB} onError={onError} />);
      await waitFor(() =>
        expect(document.head.querySelector(`script[src*="render=${siteB}"]`)).not.toBeNull(),
      );
      await act(async () => {
        document.head
          .querySelector(`script[src*="render=${site}"]`)
          ?.dispatchEvent(new Event("error"));
      });
      await tick();
      expect(onError).not.toHaveBeenCalled();

      await finishScriptLoadFor(siteB);
      await waitFor(() => expect(hiddenInput(container)?.value).toBe(`token-for-${siteB}`));
      expect(onError).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("(b) a short refresh interval does not start before the script has loaded", async () => {
      jest.useFakeTimers();
      const { container } = await mountWhileLoading(site, 100);

      // The script takes five times longer than the interval. No request may start meanwhile.
      await advance(500);
      expect(execute).not.toHaveBeenCalled();

      await finishScriptLoad();
      await tick();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(hiddenInput(container)?.value).toBe(`token-for-${site}`);

      // The interval counts from the first token, not from the mount.
      await advance(99);
      expect(execute).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(execute).toHaveBeenCalledTimes(2);
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

    it("a submit before the field is visible loads the script, so the next submit has a token", async () => {
      (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
        FakeIntersectionObserver;
      execute.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
      const { container } = render(
        <form>
          <RecaptchaField action="a" siteKey={site} lazy />
        </form>,
      );
      const form = container.querySelector("form") as HTMLFormElement;
      expect(scripts()).toHaveLength(0);

      // A programmatic submit happens before the form scrolls into view. The browser fires
      // submit, builds the form data (formdata), then sends it.
      let first!: FormData;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { cancelable: true }));
        first = new FormData(form);
        form.dispatchEvent(Object.assign(new Event("formdata"), { formData: first }));
      });
      expect(scripts()).toHaveLength(1);
      expect(first.get("g-recaptcha-response")).toBe("");

      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));

      let second!: FormData;
      await act(async () => {
        second = new FormData(form);
        form.dispatchEvent(Object.assign(new Event("formdata"), { formData: second }));
      });
      expect(second.get("g-recaptcha-response")).toBe("token-1");
      await settle();
      expect(hiddenInput(container)?.value).toBe("token-2");
    });
  });
});
