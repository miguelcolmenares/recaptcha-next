/** @jest-environment jsdom */
import { loadRecaptcha } from "../infrastructure/scriptLoader";
import type { Grecaptcha } from "../infrastructure/scriptLoader";

const scripts = () =>
  document.head.querySelectorAll<HTMLScriptElement>('script[src*="recaptcha/api.js"]');

function fakeGrecaptcha(): { api: Grecaptcha; fireReady: () => void } {
  const waiting: Array<() => void> = [];
  return {
    api: { ready: (cb) => void waiting.push(cb), execute: jest.fn().mockResolvedValue("tok") },
    fireReady: () => waiting.splice(0).forEach((cb) => cb()),
  };
}

function finishLoad(fake: ReturnType<typeof fakeGrecaptcha>) {
  window.grecaptcha = fake.api;
  scripts()[0]?.dispatchEvent(new Event("load"));
}

// The loader keeps one promise per site key for the life of the page, so every test
// uses a key of its own.
let counter = 0;
let key = "";

beforeEach(() => {
  jest.useFakeTimers();
  key = `key-${++counter}`;
});

afterEach(() => {
  jest.useRealTimers();
  document.head.innerHTML = "";
  delete window.grecaptcha;
});

describe("loadRecaptcha", () => {
  it("adds one script per site key, shared by concurrent callers", () => {
    const a = loadRecaptcha(key);
    const b = loadRecaptcha(key);
    expect(scripts()).toHaveLength(1);
    expect(a).toBe(b);
    expect(scripts()[0]?.getAttribute("src")).toBe(
      `https://www.google.com/recaptcha/api.js?render=${key}`,
    );
  });

  it("does not resolve on the load event alone, it waits for grecaptcha.ready", async () => {
    const fake = fakeGrecaptcha();
    const promise = loadRecaptcha(key);
    const onResolve = jest.fn();
    void promise.then(onResolve);

    finishLoad(fake);
    await Promise.resolve();
    expect(onResolve).not.toHaveBeenCalled();

    fake.fireReady();
    await promise;
    expect(onResolve).toHaveBeenCalledWith(fake.api);
  });

  it("rejects every waiting caller when the script fails, then allows a retry", async () => {
    const a = loadRecaptcha(key);
    const b = loadRecaptcha(key);
    const results = Promise.allSettled([a, b]);

    scripts()[0]?.dispatchEvent(new Event("error"));
    const settled = await results;

    expect(settled.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect((settled[0] as PromiseRejectedResult).reason.message).toBe(
      "Failed to load reCAPTCHA script",
    );
    expect(scripts()).toHaveLength(0);

    const retry = loadRecaptcha(key);
    expect(scripts()).toHaveLength(1);
    expect(retry).not.toBe(a);
  });

  it.each(["missing-api", "missing-ready", "throwing-ready"])(
    "replaces a loaded script with unusable API: %s",
    async (failure) => {
      const promise = loadRecaptcha(key);
      const firstTag = scripts()[0];
      if (failure === "missing-ready") {
        window.grecaptcha = { execute: jest.fn() } as unknown as Grecaptcha;
      } else if (failure === "throwing-ready") {
        window.grecaptcha = {
          ready: () => {
            throw new Error("ready failed");
          },
          execute: jest.fn(),
        };
      }
      firstTag?.dispatchEvent(new Event("load"));
      await expect(promise).rejects.toThrow();
      expect(firstTag?.isConnected).toBe(false);
      expect(scripts()).toHaveLength(0);

      const retry = loadRecaptcha(key);
      expect(scripts()).toHaveLength(1);
      expect(scripts()[0]).not.toBe(firstTag);
      const fake = fakeGrecaptcha();
      finishLoad(fake);
      fake.fireReady();
      expect(await retry).toBe(fake.api);
    },
  );

  it("replaces a completion-marked layout tag when its API is absent", async () => {
    const firstTag = document.createElement("script");
    firstTag.src = `https://www.google.com/recaptcha/api.js?render=${key}`;
    firstTag.dataset.recaptchaLoaded = "true";
    document.head.appendChild(firstTag);
    await expect(loadRecaptcha(key)).rejects.toThrow("Failed to load reCAPTCHA script");
    expect(firstTag.isConnected).toBe(false);

    const retry = loadRecaptcha(key);
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).not.toBe(firstTag);
    const fake = fakeGrecaptcha();
    finishLoad(fake);
    fake.fireReady();
    expect(await retry).toBe(fake.api);
  });

  it("keeps the script and the promise for the life of the page", async () => {
    const fake = fakeGrecaptcha();
    const first = loadRecaptcha(key);
    finishLoad(fake);
    fake.fireReady();
    await first;

    // A later caller, for example a form that mounts after a client-side navigation.
    const second = loadRecaptcha(key);
    expect(second).toBe(first);
    expect(scripts()).toHaveLength(1);
    expect(window.grecaptcha).toBe(fake.api);
  });

  it("initializes a new key even when a different key already supplied the global", async () => {
    window.grecaptcha = { ready: (callback) => callback(), execute: jest.fn() };
    const promise = loadRecaptcha(key);
    expect(scripts()).toHaveLength(1);

    const fake = fakeGrecaptcha();
    finishLoad(fake);
    fake.fireReady();
    expect(await promise).toBe(fake.api);
  });

  it("adopts a matching pending layout tag and waits for its own load", async () => {
    window.grecaptcha = { ready: (callback) => callback(), execute: jest.fn() };
    const layoutTag = document.createElement("script");
    layoutTag.src = `https://www.google.com/recaptcha/api.js?hl=en&render=${key}`;
    document.head.appendChild(layoutTag);

    const ready = loadRecaptcha(key);
    const received = jest.fn();
    void ready.then(received);
    await Promise.resolve();
    expect(received).not.toHaveBeenCalled();
    expect(scripts()).toHaveLength(1);

    const own = fakeGrecaptcha();
    window.grecaptcha = own.api;
    layoutTag.dispatchEvent(new Event("load"));
    own.fireReady();
    expect(await ready).toBe(own.api);
  });

  it("reports a matching layout tag's error and retries with a new tag", async () => {
    window.grecaptcha = { ready: (callback) => callback(), execute: jest.fn() };
    const tag = document.createElement("script");
    tag.src = `https://www.google.com/recaptcha/api.js?render=${key}`;
    document.head.appendChild(tag);

    const failed = expect(loadRecaptcha(key)).rejects.toThrow("Failed to load reCAPTCHA script");
    tag.dispatchEvent(new Event("error"));
    await failed;
    expect(scripts()).toHaveLength(0);

    const retry = loadRecaptcha(key);
    const own = fakeGrecaptcha();
    finishLoad(own);
    own.fireReady();
    expect(await retry).toBe(own.api);
  });

  it("recognizes a layout's completion marker without waiting for a repeated event", async () => {
    const tag = document.createElement("script");
    tag.src = `https://www.google.com/recaptcha/api.js?render=${key}`;
    tag.dataset.recaptchaLoaded = "true";
    document.head.appendChild(tag);
    const own = fakeGrecaptcha();
    window.grecaptcha = own.api;

    const loaded = loadRecaptcha(key);
    own.fireReady();
    expect(await loaded).toBe(own.api);
    expect(scripts()).toHaveLength(1);
  });

  it.each([
    "https://example.com/recaptcha/api.js",
    "https://www.google.com/extra/recaptcha/api.js",
  ])("ignores completion markers from another endpoint: %s", async (url) => {
    const foreign = document.createElement("script");
    foreign.src = `${url}?render=${key}`;
    foreign.dataset.recaptchaLoaded = "true";
    document.head.appendChild(foreign);
    window.grecaptcha = { ready: (callback) => callback(), execute: jest.fn() };

    const ready = loadRecaptcha(key);
    expect(scripts()).toHaveLength(2);
    const api = fakeGrecaptcha();
    window.grecaptcha = api.api;
    scripts()[1]?.dispatchEvent(new Event("load"));
    api.fireReady();
    expect(await ready).toBe(api.api);
  });

  it("does not accept a global or a stale timing entry as proof of the matching tag's load", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(performance, "getEntriesByName");
    const previousRequest = jest.fn(() => [{ entryType: "resource", initiatorType: "link" }]);
    Object.defineProperty(performance, "getEntriesByName", {
      value: previousRequest,
      configurable: true,
    });
    try {
      const tag = document.createElement("script");
      tag.src = `https://www.google.com/recaptcha/api.js?render=${key}`;
      document.head.appendChild(tag);
      window.grecaptcha = { ready: (callback) => callback(), execute: jest.fn() };
      const ready = loadRecaptcha(key);
      const resolved = jest.fn();
      void ready.then(resolved);
      await Promise.resolve();
      expect(resolved).not.toHaveBeenCalled();
      expect(previousRequest).not.toHaveBeenCalled();

      const api = fakeGrecaptcha();
      window.grecaptcha = api.api;
      tag.dispatchEvent(new Event("load"));
      api.fireReady();
      expect(await ready).toBe(api.api);
    } finally {
      if (descriptor) Object.defineProperty(performance, "getEntriesByName", descriptor);
      else delete (performance as { getEntriesByName?: unknown }).getEntriesByName;
    }
  });

  it("times out an unconfirmed tag and remembers its later successful load", async () => {
    jest.useFakeTimers();
    const tag = document.createElement("script");
    tag.src = `https://www.google.com/recaptcha/api.js?render=${key}`;
    document.head.appendChild(tag);
    window.grecaptcha = { ready: (callback) => callback(), execute: jest.fn() };
    const timeout = expect(loadRecaptcha(key)).rejects.toThrow("Failed to load reCAPTCHA script");
    await jest.advanceTimersByTimeAsync(15_000);
    await timeout;
    expect(scripts()).toHaveLength(1);

    const api = fakeGrecaptcha();
    window.grecaptcha = api.api;
    tag.dispatchEvent(new Event("load"));
    api.fireReady();
    expect(await loadRecaptcha(key)).toBe(api.api);
    expect(scripts()).toHaveLength(1);
  });

  it("times out a fresh tag and shares its later successful load with a retry", async () => {
    const initial = loadRecaptcha(key);
    const rejected = expect(initial).rejects.toThrow("Failed to load reCAPTCHA script");
    const tag = scripts()[0]!;
    const subscribe = jest.spyOn(tag, "addEventListener");
    await jest.advanceTimersByTimeAsync(15_000);
    await rejected;

    const retry = loadRecaptcha(key);
    expect(retry).not.toBe(initial);
    expect(scripts()).toHaveLength(1);
    expect(subscribe).not.toHaveBeenCalled();
    const api = fakeGrecaptcha();
    finishLoad(api);
    api.fireReady();
    expect(await retry).toBe(api.api);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("bounds readiness too and recovers when the original ready callback finally runs", async () => {
    const api = fakeGrecaptcha();
    const initial = loadRecaptcha(key);
    finishLoad(api);
    const rejected = expect(initial).rejects.toThrow("Failed to load reCAPTCHA script");
    await jest.advanceTimersByTimeAsync(15_000);
    await rejected;

    const retry = loadRecaptcha(key);
    expect(scripts()).toHaveLength(1);
    api.fireReady();
    expect(await retry).toBe(api.api);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("keeps a separate load for each site key", () => {
    loadRecaptcha(`${key}-a`);
    loadRecaptcha(`${key}-b`);
    expect(scripts()).toHaveLength(2);
  });
});
