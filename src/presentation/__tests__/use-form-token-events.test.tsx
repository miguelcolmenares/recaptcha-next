/** @jest-environment jsdom */
import type { Grecaptcha } from "@/infrastructure";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { RecaptchaField } from "@/presentation";
import { useFormTokenEvents } from "@/presentation/use-form-token-events";
import {
  scripts,
  hiddenInput,
  execute,
  site,
  finishScriptLoad,
  tick,
  settle,
  advance,
} from "./field-fixture";

describe("enclosing form token events", () => {
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

    it("(f) a submit while a renewal is in flight has no token to spend, so it asks for nothing more", async () => {
      const { form, value } = await mountInForm();
      // The first submit's renewal stays pending until the test resolves it.
      let resolveSecond!: (token: string) => void;
      execute.mockImplementationOnce(
        () => new Promise<string>((resolve) => (resolveSecond = resolve)),
      );

      await fire(form, "submit");
      await fire(form, "formdata");
      await settle();
      expect(execute).toHaveBeenCalledTimes(2);

      // A second submit arrives while that request is still open. The field is already empty,
      // and the token that request delivers has not been read by anyone.
      await fire(form, "submit");
      await fire(form, "formdata");
      await settle();
      expect(execute).toHaveBeenCalledTimes(2);

      await act(async () => resolveSecond("token-2"));
      await waitFor(() => expect(value()).toBe("token-2"));
      await settle();

      expect(execute).toHaveBeenCalledTimes(2);
      expect(value()).toBe("token-2");
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
      // The retry found the field empty, so it asked for nothing. The held request delivers the
      // token the next submit will carry.
      await act(async () => resolveRenewal("token-2"));
      await waitFor(() => expect(value()).toBe("token-2"));
      await settle();
      expect(execute).toHaveBeenCalledTimes(2);
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

      // The zero-delay task of that read runs. The request in flight delivered a token that no
      // read has seen, so it stays in the field and nothing more is requested.
      await advance(1);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(value()).toBe("token-2");
    });
  });

  describe("which reads of the form spend the token", () => {
    /** Reads the form as the browser does: builds the FormData, then fires formdata with it. */
    const read = (form: HTMLFormElement) => {
      const formData = new FormData(form);
      form.dispatchEvent(Object.assign(new Event("formdata"), { formData }));
      return formData;
    };

    /** Mounts a loaded field in a form on fake timers. Its first token is already in the field. */
    async function mountForm(refreshIntervalMs?: number) {
      jest.useFakeTimers();
      const utils = render(
        <form>
          <RecaptchaField action="a" siteKey={site} refreshIntervalMs={refreshIntervalMs} />
        </form>,
      );
      const form = utils.container.querySelector("form") as HTMLFormElement;
      await finishScriptLoad();
      await tick();
      return { ...utils, form, value: () => hiddenInput(utils.container)?.value };
    }

    it("two reads in one task send the token once and ask for one new token", async () => {
      let issued = 0;
      execute.mockImplementation(async () => `token-${++issued}`);
      const { form, value } = await mountForm();
      expect(value()).toBe("token-1");

      let first!: FormData;
      let second!: FormData;
      await act(async () => {
        first = read(form);
        second = read(form);
      });
      await advance(0);

      expect(first.get("g-recaptcha-response")).toBe("token-1");
      expect(second.get("g-recaptcha-response")).toBe("");
      expect(execute).toHaveBeenCalledTimes(2);
      expect(value()).toBe("token-2");
    });

    it("a read followed by requestSubmit() in one task sends the token once, with one renewal", async () => {
      let issued = 0;
      execute.mockImplementation(async () => `token-${++issued}`);
      const { form, value } = await mountForm();
      const sent: unknown[] = [];
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        // What a submit handler does: read the form, which also fires formdata in a browser.
        sent.push(read(form).get("g-recaptcha-response"));
      });

      let first!: FormData;
      await act(async () => {
        first = read(form);
        form.requestSubmit();
      });
      await advance(0);

      expect(first.get("g-recaptcha-response")).toBe("token-1");
      expect(sent).toEqual([""]);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(value()).toBe("token-2");
    });

    it("a read of an empty field asks for nothing, so a failing renewal keeps its backoff", async () => {
      execute.mockResolvedValueOnce("token-1").mockRejectedValue(new Error("down"));
      const { form, value } = await mountForm();

      await act(async () => {
        read(form);
      });
      await advance(0); // the renewal starts, and fails
      expect(execute).toHaveBeenCalledTimes(2);
      expect(value()).toBe("");

      // The field is empty and the retry is 5 seconds away. Reading again spends nothing.
      await act(async () => {
        read(form);
        read(form);
      });
      await advance(0);
      await advance(4998);
      expect(execute).toHaveBeenCalledTimes(2);
      await advance(1);
      expect(execute).toHaveBeenCalledTimes(2);
      await advance(1); // 5 s after the failure
      expect(execute).toHaveBeenCalledTimes(3);
    });

    it("a read while a request is in flight does not ask for another one", async () => {
      const { form, value } = await mountForm(1000);
      let resolveTimerRenewal!: (token: string) => void;
      execute.mockImplementationOnce(
        () => new Promise<string>((resolve) => (resolveTimerRenewal = resolve)),
      );
      await advance(1000);
      expect(execute).toHaveBeenCalledTimes(2);

      await act(async () => {
        read(form);
      });
      await advance(0);
      expect(execute).toHaveBeenCalledTimes(2);

      await act(async () => resolveTimerRenewal("token-2"));
      await tick();
      expect(value()).toBe("token-2");
      await advance(0);
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("a read while a request is in flight that then fails does not skip the backoff", async () => {
      const { form, value } = await mountForm(1000);
      let rejectRenewal!: (cause: Error) => void;
      execute.mockImplementationOnce(
        () => new Promise<string>((_, reject) => (rejectRenewal = reject)),
      );
      await advance(1000);
      expect(execute).toHaveBeenCalledTimes(2);

      // The request fails in the same task as the read, before the zero-delay task runs.
      await act(async () => {
        read(form);
        rejectRenewal(new Error("down"));
      });
      await advance(0);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(value()).toBe("");

      execute.mockResolvedValueOnce("token-2");
      await advance(4998);
      expect(execute).toHaveBeenCalledTimes(2);
      await advance(2); // 5 s after the failure
      expect(execute).toHaveBeenCalledTimes(3);
      expect(value()).toBe("token-2");
    });

    it("a token that arrives between the read and the zero-delay task survives, with no extra request", async () => {
      let issued = 0;
      execute.mockImplementation(async () => `token-${++issued}`);
      jest.useFakeTimers();
      // Created before the field's own refresh timer, so at 1000 ms it runs first. Its read
      // schedules the renewal task. The refresh timer then starts a request that answers at once,
      // before that task runs. The clock stays at 0 until here, so the script is loaded by hand,
      // since `waitFor` would move fake time.
      let form: HTMLFormElement | null = null;
      setTimeout(() => form && read(form), 1000);
      const { container } = render(
        <form>
          <RecaptchaField action="a" siteKey={site} refreshIntervalMs={1000} />
        </form>,
      );
      form = container.querySelector("form");
      const value = () => hiddenInput(container)?.value;
      await act(async () => {
        window.grecaptcha = { ready: (cb) => cb(), execute: execute as Grecaptcha["execute"] };
        scripts()[0]?.dispatchEvent(new Event("load"));
      });
      await tick();
      expect(value()).toBe("token-1");

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      await tick();

      expect(value()).toBe("token-2");
      // Fake timers give a zero delay set during a tick 1 ms, so the renewal task runs here.
      await advance(1);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(value()).toBe("token-2");
    });

    it("renews a replacement consumed while the previous read's task is still queued", async () => {
      jest.useFakeTimers();
      let form: HTMLFormElement | null = null;
      let generated = 0;
      execute.mockImplementation(async () => `token-${++generated}`);
      // The read queues a task immediately before the periodic request produces token-2.
      setTimeout(() => form && read(form), 1000);
      const { container } = render(
        <form>
          <RecaptchaField
            action="a"
            siteKey={site}
            refreshIntervalMs={1000}
            onTokenGenerated={(token) => {
              if (token === "token-2" && form) read(form);
            }}
          />
        </form>,
      );
      form = container.querySelector("form");
      await act(async () => {
        window.grecaptcha = { ready: (cb) => cb(), execute: execute as Grecaptcha["execute"] };
        scripts()[0]?.dispatchEvent(new Event("load"));
      });
      await tick();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1001);
      });
      await tick();
      expect(execute).toHaveBeenCalledTimes(3);
      expect(hiddenInput(container)?.value).toBe("token-3");
    });

    it("starts a renewal by 110 seconds even when the requested interval is longer", async () => {
      let generated = 0;
      execute.mockImplementation(async () => `token-${++generated}`);
      const { value } = await mountForm(180_000);
      await advance(109_999);
      expect(execute).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(value()).toBe("token-2");
    });

    it("clears the pending request deadline immediately when the field unmounts", async () => {
      const { unmount } = await mountForm(1000);
      execute.mockImplementationOnce(() => new Promise<string>(() => {}));
      await advance(1000);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBeGreaterThan(0);
      unmount();
      await tick();
      // Flush Testing Library's zero-delay act bookkeeping, without advancing the request deadline.
      jest.advanceTimersByTime(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("ignores a formdata event from a form nested inside its own form", async () => {
      const { container, form, value } = await mountForm(1000);
      const nested = document.createElement("form");
      form.appendChild(nested);

      await act(async () => {
        nested.dispatchEvent(
          Object.assign(new Event("formdata", { bubbles: true }), { formData: new FormData() }),
        );
      });
      await advance(0);

      expect(execute).toHaveBeenCalledTimes(1);
      expect(value()).toBe("token-1");
      expect(
        new FormData(container.querySelector("form") as HTMLFormElement).get(
          "g-recaptcha-response",
        ),
      ).toBe("token-1");
    });

    it("changing only refreshIntervalMs neither asks for a token nor drops the one it has", async () => {
      jest.useFakeTimers();
      const { container, rerender } = render(
        <RecaptchaField action="a" siteKey={site} refreshIntervalMs={1000} />,
      );
      await finishScriptLoad();
      await tick();
      expect(hiddenInput(container)?.value).toBe("token-1");

      rerender(<RecaptchaField action="a" siteKey={site} refreshIntervalMs={5000} />);
      await tick();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(hiddenInput(container)?.value).toBe("token-1");

      // The timer that was running fires once, and the new interval applies from then on.
      await advance(1000);
      expect(execute).toHaveBeenCalledTimes(2);
      await advance(4999);
      expect(execute).toHaveBeenCalledTimes(2);
      await advance(1);
      expect(execute).toHaveBeenCalledTimes(3);
    });
  });
});

describe("useFormTokenEvents in isolation", () => {
  function anchorInForm() {
    const form = document.createElement("form");
    const anchor = document.createElement("span");
    form.append(anchor);
    return { form, anchorRef: { current: anchor } };
  }

  it("activates on submit, but spends only when the enclosing form data is read", () => {
    const { form, anchorRef } = anchorInForm();
    const onActivate = jest.fn();
    const onTokenSpent = jest.fn();
    renderHook(() => useFormTokenEvents({ anchorRef, siteKey: "site", onActivate, onTokenSpent }));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onTokenSpent).not.toHaveBeenCalled();
    form.dispatchEvent(new Event("formdata"));
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onTokenSpent).toHaveBeenCalledTimes(1);
    const nested = document.createElement("form");
    form.append(nested);
    nested.dispatchEvent(new Event("formdata", { bubbles: true }));
    expect(onTokenSpent).toHaveBeenCalledTimes(1);
  });

  it("uses current callbacks and removes listeners on unmount", () => {
    const { form, anchorRef } = anchorInForm();
    const previous = jest.fn();
    const next = jest.fn();
    const { rerender, unmount } = renderHook(
      ({ onTokenSpent }) => useFormTokenEvents({ anchorRef, siteKey: "site", onTokenSpent }),
      { initialProps: { onTokenSpent: previous } },
    );
    rerender({ onTokenSpent: next });
    form.dispatchEvent(new Event("formdata"));
    expect(previous).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    unmount();
    form.dispatchEvent(new Event("formdata"));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("waits for a site key before subscribing and handles a field outside a form", () => {
    const { form, anchorRef } = anchorInForm();
    const onTokenSpent = jest.fn();
    const { rerender } = renderHook(
      ({ siteKey }: { siteKey?: string }) =>
        useFormTokenEvents({ anchorRef, siteKey, onTokenSpent }),
      { initialProps: {} },
    );
    form.dispatchEvent(new Event("formdata"));
    expect(onTokenSpent).not.toHaveBeenCalled();
    rerender({ siteKey: "site" });
    form.dispatchEvent(new Event("formdata"));
    expect(onTokenSpent).toHaveBeenCalledTimes(1);
    const detached = { current: document.createElement("span") };
    expect(() =>
      renderHook(() => useFormTokenEvents({ anchorRef: detached, siteKey: "site", onTokenSpent })),
    ).not.toThrow();
  });
});
