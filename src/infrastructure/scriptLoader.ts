import { RECAPTCHA_SCRIPT_URL } from "../domain";

/** The part of `window.grecaptcha` this package uses. */
export interface Grecaptcha {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

const LOAD_ERROR_MESSAGE = "Failed to load reCAPTCHA script";

// One promise per site key, kept for the life of the page.
//
// A successfully loaded script is never removed. Google keeps its own state (badge, iframes, extra
// scripts), and removing our tag does not reset it. Tested against real Google: loading it again
// after a client-side navigation left duplicate badges and extra scripts, and sometimes a global
// with no script tag. Loading once, as a plain <script> in a layout would, avoids all of that.
const loads = new Map<string, Promise<Grecaptcha>>();
const registrations = new WeakMap<HTMLScriptElement, Promise<Grecaptcha>>();
const SCRIPT_TIMEOUT_MS = 15_000;

function whenReady(grecaptcha: Grecaptcha): Promise<Grecaptcha> {
  return new Promise((resolve) => grecaptcha.ready(() => resolve(grecaptcha)));
}

/** Find the API endpoint for this key, allowing Google's extra query parameters. */
function findLayoutScript(siteKey: string): HTMLScriptElement | undefined {
  const expected = new URL(RECAPTCHA_SCRIPT_URL);
  for (const element of document.scripts) {
    if (!element.src) continue;
    try {
      const actual = new URL(element.src, document.baseURI);
      if (
        actual.origin === expected.origin &&
        actual.pathname === expected.pathname &&
        actual.searchParams.get("render") === siteKey
      )
        return element;
    } catch {
      // An invalid URL cannot identify a reCAPTCHA loader.
    }
  }
  return undefined;
}

/** Read the global only after the requested key's script has executed. */
function readyApi(): Promise<Grecaptcha> {
  const api = window.grecaptcha;
  if (!api || typeof api.ready !== "function") return Promise.reject(new Error(LOAD_ERROR_MESSAGE));
  return whenReady(api);
}

/** Keep one event registration per element, even when an earlier caller timed out. */
function registerScript(element: HTMLScriptElement): Promise<Grecaptcha> {
  const registered = registrations.get(element);
  if (registered) return registered;
  if (element.dataset.recaptchaLoaded === "true") return readyApi();

  const registration = new Promise<Grecaptcha>((resolve, reject) => {
    function detach() {
      element.removeEventListener("load", loaded);
      element.removeEventListener("error", failed);
    }
    function loaded() {
      detach();
      element.dataset.recaptchaLoaded = "true";
      resolve(readyApi());
    }
    function failed() {
      detach();
      element.remove();
      reject(new Error(LOAD_ERROR_MESSAGE));
    }
    element.addEventListener("load", loaded, { once: true });
    element.addEventListener("error", failed, { once: true });
  });
  registrations.set(element, registration);
  void registration.catch(() => registrations.delete(element));
  return registration;
}

/** Bound the wait for this tag and its readiness callback, without removing a loaded script. */
function waitForScript(element: HTMLScriptElement): Promise<Grecaptcha> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(LOAD_ERROR_MESSAGE)), SCRIPT_TIMEOUT_MS);
    void registerScript(element).then(
      (api) => {
        clearTimeout(deadline);
        resolve(api);
      },
      (error: unknown) => {
        clearTimeout(deadline);
        reject(error);
      },
    );
  });
}

function start(siteKey: string): Promise<Grecaptcha> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error(LOAD_ERROR_MESSAGE));
  }
  const layoutScript = findLayoutScript(siteKey);
  if (layoutScript) return waitForScript(layoutScript);

  const element = document.createElement("script");
  element.src = `${RECAPTCHA_SCRIPT_URL}?render=${encodeURIComponent(siteKey)}`;
  element.async = true;
  const pending = waitForScript(element);
  document.head.appendChild(element);
  return pending;
}

/**
 * Load reCAPTCHA once per site key. Every caller gets the same promise, so concurrent callers
 * share one script and all of them see the same failure. A failed load is forgotten, so the
 * next call tries again. Browser only.
 */
export function loadRecaptcha(siteKey: string): Promise<Grecaptcha> {
  const existing = loads.get(siteKey);
  if (existing) return existing;

  const promise = start(siteKey);
  loads.set(siteKey, promise);
  promise.catch(() => {
    if (loads.get(siteKey) === promise) loads.delete(siteKey);
  });
  return promise;
}
