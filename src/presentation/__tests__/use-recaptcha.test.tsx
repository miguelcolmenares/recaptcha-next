/** @jest-environment jsdom */
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { RecaptchaField, useRecaptcha } from "@/presentation";
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

describe("script loading hook", () => {
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

  describe("a script that fails to load", () => {
    const scriptFor = (key: string) =>
      document.head.querySelector(`script[src$="render=${encodeURIComponent(key)}"]`);

    /** Plays Google failing: the tag for this key reports an error. */
    async function failScriptFor(key: string) {
      await waitFor(() => expect(scriptFor(key)).not.toBeNull());
      await act(async () => {
        scriptFor(key)?.dispatchEvent(new Event("error"));
      });
      await tick();
    }

    it("is loaded again after 5, 10, 20 and then 30 seconds, and each failure is reported once", async () => {
      jest.useFakeTimers();
      const onError = jest.fn();
      render(<RecaptchaField action="a" siteKey={site} onError={onError} />);

      await failScriptFor(site);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(scriptFor(site)).toBeNull();

      const waits = [5_000, 10_000, 20_000, 30_000, 30_000];
      for (const [index, wait] of waits.entries()) {
        await advance(wait - 1);
        expect(scriptFor(site)).toBeNull();
        await advance(1);
        expect(scriptFor(site)).not.toBeNull();
        await failScriptFor(site);
        expect(onError).toHaveBeenCalledTimes(index + 2);
      }
    });

    it("recovers when a retry succeeds: the token arrives and no more loads are tried", async () => {
      jest.useFakeTimers();
      const { container } = render(<RecaptchaField action="a" siteKey={site} />);
      await failScriptFor(site);

      await advance(5_000);
      await finishScriptLoadFor(site);
      await tick();

      expect(hiddenInput(container)?.value).toBe("token-1");
      await advance(60_000);
      expect(scripts()).toHaveLength(1);
    });

    it("stops retrying when the field unmounts", async () => {
      jest.useFakeTimers();
      const { unmount } = render(<RecaptchaField action="a" siteKey={site} />);
      await failScriptFor(site);

      unmount();
      await advance(120_000);

      expect(scriptFor(site)).toBeNull();
    });

    it("stops retrying the old key when the key changes, and the new key starts again at 5 seconds", async () => {
      jest.useFakeTimers();
      const otherSite = `${site}-other`;
      const { rerender } = render(<RecaptchaField action="a" siteKey={site} />);
      await failScriptFor(site);
      await advance(5_000);
      await failScriptFor(site); // the next wait for this key is 20 s

      rerender(<RecaptchaField action="a" siteKey={otherSite} />);
      await failScriptFor(otherSite);
      await advance(4_999);
      expect(scriptFor(otherSite)).toBeNull();
      await advance(1);
      expect(scriptFor(otherSite)).not.toBeNull();

      // Nothing tries the first key again while the field has the new one.
      await failScriptFor(otherSite);
      await advance(10_000);
      expect(scriptFor(site)).toBeNull();
    });

    it("a retry that was waiting for the old key does not restart the new key once it has loaded", async () => {
      jest.useFakeTimers();
      const otherSite = `${site}-other`;
      const { container, rerender } = render(<RecaptchaField action="a" siteKey={site} />);
      await failScriptFor(site);
      await advance(5_000);
      await failScriptFor(site); // the next try for this key is 20 s away

      rerender(<RecaptchaField action="a" siteKey={otherSite} />);
      await finishScriptLoadFor(otherSite);
      await tick();
      expect(hiddenInput(container)?.value).toBe("token-1");

      await advance(25_000);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(hiddenInput(container)?.value).toBe("token-1");
    });

    it("starts over at 5 seconds when the key comes back after a failure", async () => {
      jest.useFakeTimers();
      const otherSite = `${site}-other`;
      const onError = jest.fn();
      const { rerender } = render(<RecaptchaField action="a" siteKey={site} onError={onError} />);
      await failScriptFor(site);
      await advance(5_000);
      await failScriptFor(site);
      expect(onError).toHaveBeenCalledTimes(2);

      rerender(<RecaptchaField action="a" siteKey={otherSite} onError={onError} />);
      await waitFor(() => expect(scriptFor(otherSite)).not.toBeNull());
      rerender(<RecaptchaField action="a" siteKey={site} onError={onError} />);
      // A new load starts at once for the key that comes back, and it is not reported as failed.
      await waitFor(() => expect(scriptFor(site)).not.toBeNull());
      expect(onError).toHaveBeenCalledTimes(2);

      await failScriptFor(site);
      expect(onError).toHaveBeenCalledTimes(3);
      await advance(4_999);
      expect(scriptFor(site)).toBeNull();
      await advance(1);
      expect(scriptFor(site)).not.toBeNull();
    });

    it("A to B to A does not report A's old failure again while its new load is pending", async () => {
      const otherSite = `${site}-other`;
      const onError = jest.fn();
      const { rerender } = render(<RecaptchaField action="a" siteKey={site} onError={onError} />);
      await failScriptFor(site);
      expect(onError).toHaveBeenCalledTimes(1);

      rerender(<RecaptchaField action="a" siteKey={otherSite} onError={onError} />);
      await waitFor(() => expect(scriptFor(otherSite)).not.toBeNull());
      rerender(<RecaptchaField action="a" siteKey={site} onError={onError} />);
      await waitFor(() => expect(scriptFor(site)).not.toBeNull());
      await tick();

      expect(onError).toHaveBeenCalledTimes(1);
    });
  });
});

describe("useRecaptcha in isolation", () => {
  it("stays idle when disabled and executes with the latest action after activation", async () => {
    const { result, rerender } = renderHook(
      ({ enabled, action }) => useRecaptcha({ siteKey: site, enabled, action }),
      { initialProps: { enabled: false, action: "login" } },
    );
    expect(result.current.status).toBe("idle");
    expect(scripts()).toHaveLength(0);
    await expect(result.current.execute()).rejects.toThrow(
      "reCAPTCHA is not enabled or has no site key",
    );
    rerender({ enabled: true, action: "login" });
    expect(result.current.status).toBe("loading");
    await finishScriptLoad();
    expect(result.current.status).toBe("ready");
    await expect(result.current.execute()).resolves.toBe("token-1");
    expect(execute).toHaveBeenLastCalledWith(site, { action: "login" });
    rerender({ enabled: true, action: "checkout" });
    await result.current.execute();
    expect(execute).toHaveBeenLastCalledWith(site, { action: "checkout" });
    expect(scripts()).toHaveLength(1);
  });
});
