/** @jest-environment jsdom */
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { RecaptchaField } from "@/presentation";
import { useLazyVisibility } from "@/presentation/use-lazy-visibility";
import {
  scripts,
  hiddenInput,
  execute,
  site,
  finishScriptLoad,
  tick,
  settle,
  FakeIntersectionObserver,
} from "./field-fixture";

describe("lazy visibility", () => {
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

    it("loads when lazy is disabled before visibility and stays active when lazy returns", async () => {
      (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
        FakeIntersectionObserver;
      const { container, rerender } = render(
        <form>
          <RecaptchaField action="a" siteKey={site} lazy />
        </form>,
      );
      expect(scripts()).toHaveLength(0);

      rerender(
        <form>
          <RecaptchaField action="a" siteKey={site} lazy={false} />
        </form>,
      );
      await tick();
      expect(scripts()).toHaveLength(1);

      // Re-enabling lazy while the eager request is pending must not cancel that load.
      rerender(
        <form>
          <RecaptchaField action="a" siteKey={site} lazy />
        </form>,
      );
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
      expect(execute).toHaveBeenCalledTimes(1);
      expect(scripts()).toHaveLength(1);
    });

    it("falls back to eager loading when IntersectionObserver does not exist", async () => {
      const { container } = render(<RecaptchaField action="a" siteKey={site} lazy />);
      await finishScriptLoad();
      await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
    });

    it("a site key that arrives after mount is still loaded lazily", async () => {
      (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
        FakeIntersectionObserver;
      const saved = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
      delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
      try {
        const { container, rerender } = render(
          <form>
            <RecaptchaField action="a" lazy />
          </form>,
        );
        expect(scripts()).toHaveLength(0);

        // The key arrives (a prop that was not ready at mount). The field has not been seen yet.
        rerender(
          <form>
            <RecaptchaField action="a" siteKey={site} lazy />
          </form>,
        );
        await tick();
        expect(scripts()).toHaveLength(0);
        expect(FakeIntersectionObserver.instances.at(-1)?.observed[0]).toBe(
          container.querySelector("form"),
        );

        await act(async () => FakeIntersectionObserver.instances.at(-1)?.show());
        await finishScriptLoad();
        await waitFor(() => expect(hiddenInput(container)?.value).toBe("token-1"));
      } finally {
        if (saved === undefined) delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
        else process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = saved;
      }
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

describe("useLazyVisibility in isolation", () => {
  it("passes the configured margin, observes the form, and disconnects after visibility", () => {
    let notify!: IntersectionObserverCallback;
    const disconnect = jest.fn();
    const observe = jest.fn();
    const construct = jest.fn((callback: IntersectionObserverCallback) => {
      notify = callback;
      return { disconnect, observe };
    });
    globalThis.IntersectionObserver = construct as unknown as typeof IntersectionObserver;
    const form = document.createElement("form");
    const anchor = document.createElement("span");
    form.append(anchor);
    const { result, unmount } = renderHook(() =>
      useLazyVisibility({
        anchorRef: { current: anchor },
        siteKey: "site",
        lazy: true,
        rootMargin: "50px",
      }),
    );
    expect(result.current.visible).toBe(false);
    expect(construct).toHaveBeenCalledWith(expect.any(Function), { rootMargin: "50px" });
    expect(observe).toHaveBeenCalledWith(form);
    act(() =>
      notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver),
    );
    expect(result.current.visible).toBe(false);
    act(() =>
      notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver),
    );
    expect(result.current.visible).toBe(true);
    expect(disconnect).toHaveBeenCalled();
    unmount();
  });

  it("allows explicit activation and never deactivates after an eager render", () => {
    globalThis.IntersectionObserver =
      FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    const anchorRef = { current: document.createElement("span") };
    const { result, rerender } = renderHook(
      ({ lazy }) => useLazyVisibility({ anchorRef, siteKey: "site", lazy, rootMargin: "200px" }),
      { initialProps: { lazy: true } },
    );
    expect(result.current.visible).toBe(false);
    act(() => result.current.activate());
    expect(result.current.visible).toBe(true);
    rerender({ lazy: false });
    rerender({ lazy: true });
    expect(result.current.visible).toBe(true);
  });
});
