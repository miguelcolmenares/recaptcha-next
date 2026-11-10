/** @jest-environment jsdom */
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { Component } from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { RecaptchaField } from "@/presentation";
import { useTokenRenewal } from "@/presentation/use-token-renewal";
import {
  scripts,
  hiddenInput,
  execute,
  site,
  finishScriptLoad,
  finishScriptLoadFor,
  tick,
  settle,
  advance,
} from "./field-fixture";

describe("token renewal React adapter", () => {
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

  describe("a callback that throws", () => {
    let logged: jest.SpyInstance;

    beforeEach(() => {
      logged = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      logged.mockRestore();
    });

    /** Mounts a loaded field on fake timers, with the callbacks the test passes. */
    async function mountWith(props: {
      onTokenGenerated?: (token: string) => void;
      onError?: (error: Error) => void;
      refreshIntervalMs?: number;
    }) {
      jest.useFakeTimers();
      const utils = render(<RecaptchaField action="a" siteKey={site} {...props} />);
      await finishScriptLoad();
      await tick();
      return { ...utils, value: () => hiddenInput(utils.container)?.value };
    }

    it.each([
      ["onTokenGenerated", "error"],
      ["onTokenGenerated", "object"],
      ["onError", "error"],
      ["onError", "object"],
    ] as const)("keeps %s callback failure logs private for an %s cause", async (name, kind) => {
      const privateToken = "private-callback-test-token";
      const privateDetail = "private-callback-test-detail";
      const fail = () => {
        if (kind === "error") throw new Error(`${privateToken}: ${privateDetail}`);
        throw { token: privateToken, detail: privateDetail };
      };
      if (name === "onError") execute.mockRejectedValue(new Error(privateToken));
      else execute.mockResolvedValue(privateToken);

      const { value } = await mountWith({ [name]: fail, refreshIntervalMs: 1000 });
      expect(logged.mock.calls).toEqual([[`[recaptcha-next] ${name} threw`]]);
      if (name === "onTokenGenerated") expect(value()).toBe(privateToken);

      await advance(name === "onError" ? 5000 : 1000);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(logged.mock.calls).toEqual([
        [`[recaptcha-next] ${name} threw`],
        [`[recaptcha-next] ${name} threw`],
      ]);
      const output = JSON.stringify(logged.mock.calls);
      expect(output).not.toContain(privateToken);
      expect(output).not.toContain(privateDetail);
    });

    it("onTokenGenerated throwing still sets the expiry timer and the next renewal", async () => {
      execute.mockResolvedValueOnce("token-1").mockRejectedValue(new Error("offline"));
      const { value } = await mountWith({
        onTokenGenerated: () => {
          throw new Error("consumer bug");
        },
      });
      expect(value()).toBe("token-1");
      expect(logged).toHaveBeenCalledWith("[recaptcha-next] onTokenGenerated threw");

      await advance(90_000);
      expect(execute).toHaveBeenCalledTimes(2);
      await advance(29_999);
      expect(value()).toBe("token-1");
      await advance(1); // 120 s after the token was issued
      expect(value()).toBe("");
    });

    it("onTokenGenerated throwing does not stop the renewals on the interval", async () => {
      let issued = 0;
      execute.mockImplementation(async () => `token-${++issued}`);
      const { container, value } = await mountWith({
        onTokenGenerated: () => {
          throw new Error("consumer bug");
        },
        refreshIntervalMs: 1000,
      });
      expect(value()).toBe("token-1");

      await advance(1000);
      await advance(1000);
      expect(value()).toBe("token-3");
      expect(hiddenInput(container)?.value).toBe("token-3");
    });

    it("onError throwing keeps the failure count and the retry going", async () => {
      execute.mockRejectedValue(new Error("down"));
      const onError = jest.fn(() => {
        throw new Error("consumer bug");
      });
      await mountWith({ onError, refreshIntervalMs: 1000 });
      expect(execute).toHaveBeenCalledTimes(1);

      await advance(4999);
      expect(execute).toHaveBeenCalledTimes(1);
      await advance(1); // 5 s
      expect(execute).toHaveBeenCalledTimes(2);
      await advance(9999);
      expect(execute).toHaveBeenCalledTimes(2);
      await advance(1); // 10 s later, so the failure count went up
      expect(execute).toHaveBeenCalledTimes(3);
      expect(onError).toHaveBeenCalledTimes(3);
      expect(logged).toHaveBeenCalledWith("[recaptcha-next] onError threw");
    });

    it("an onError that throws for a failed script load does not reach an error boundary", async () => {
      class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
        override state = { failed: false };
        static getDerivedStateFromError() {
          return { failed: true };
        }
        override render() {
          return this.state.failed ? <p>boundary</p> : this.props.children;
        }
      }
      const onError = jest.fn(() => {
        throw new Error("consumer bug");
      });
      const { container } = render(
        <Boundary>
          <RecaptchaField action="a" siteKey={site} onError={onError} />
        </Boundary>,
      );
      await waitFor(() => expect(scripts()).toHaveLength(1));
      await act(async () => {
        scripts()[0]?.dispatchEvent(new Event("error"));
      });
      await tick();

      expect(onError).toHaveBeenCalledWith(new Error("Failed to load reCAPTCHA script"));
      expect(container.textContent).not.toContain("boundary");
      expect(hiddenInput(container)).not.toBeNull();
      expect(logged).toHaveBeenCalledWith("[recaptcha-next] onError threw");
    });
  });

  describe("going from one action to another and back", () => {
    it("A to B to A with failing requests shows no token from before, in the input or the FormData", async () => {
      jest.useFakeTimers();
      execute.mockResolvedValueOnce("token-a").mockRejectedValue(new Error("down"));
      const withAction = (action: string) => (
        <form>
          <RecaptchaField action={action} siteKey={site} />
        </form>
      );
      const { container, rerender } = render(withAction("a"));
      const form = container.querySelector("form") as HTMLFormElement;
      await finishScriptLoad();
      await tick();
      expect(hiddenInput(container)?.value).toBe("token-a");

      rerender(withAction("b"));
      await tick();
      expect(hiddenInput(container)?.value).toBe("");

      rerender(withAction("a"));
      await tick();
      expect(hiddenInput(container)?.value).toBe("");
      expect(new FormData(form).get("g-recaptcha-response")).toBe("");

      // The old token has no expiry timer any more, so nothing would ever clear it later.
      await advance(150_000);
      expect(hiddenInput(container)?.value).toBe("");
    });

    it("A to B to A with a site key change does the same", async () => {
      const otherSite = `${site}-other`;
      execute.mockResolvedValueOnce("token-a").mockRejectedValue(new Error("down"));
      const withKey = (key: string) => <RecaptchaField action="a" siteKey={key} />;
      const { container, rerender } = render(withKey(site));
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-a"));

      rerender(withKey(otherSite));
      await finishScriptLoadFor(otherSite);
      await tick();
      rerender(withKey(site));
      await tick();

      expect(hiddenInput(container)?.value).toBe("");
    });
  });
});

describe("useTokenRenewal in isolation", () => {
  it("writes the input before callbacks and clears it as soon as the token is spent", async () => {
    jest.useFakeTimers();
    const inputRef = { current: document.createElement("input") };
    const makeToken = jest.fn().mockResolvedValue("first");
    const notified = jest.fn(() => expect(inputRef.current.value).toBe("first"));
    const { result, unmount } = renderHook(() =>
      useTokenRenewal({
        action: "login",
        siteKey: "site",
        inputRef,
        status: "ready",
        error: null,
        execute: makeToken,
        refreshIntervalMs: 90_000,
        onTokenGenerated: notified,
      }),
    );
    await tick();
    expect(result.current.token).toBe("first");
    expect(notified).toHaveBeenCalledWith("first");
    act(() => result.current.spendToken());
    expect(inputRef.current.value).toBe("");
    expect(result.current.token).toBe("");
    unmount();
    await advance(180_000);
    expect(makeToken).toHaveBeenCalledTimes(1);
    expect(inputRef.current.value).toBe("");
  });
});
