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
