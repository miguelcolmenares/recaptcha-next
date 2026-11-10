import { act, waitFor } from "@testing-library/react";
import type { Grecaptcha } from "@/infrastructure";

export const scripts = () => document.head.querySelectorAll('script[src*="recaptcha/api.js"]');
export const hiddenInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[name="g-recaptcha-response"]');

export let execute: jest.Mock;
let counter = 0;
export let site = "";

/** Plays the part of Google: the script tag "loads" and grecaptcha appears. */
export async function finishScriptLoad() {
  await waitFor(() => expect(scripts()).toHaveLength(1));
  await act(async () => {
    const api: Grecaptcha = { ready: (cb) => cb(), execute: execute as Grecaptcha["execute"] };
    window.grecaptcha = api;
    scripts()[0]?.dispatchEvent(new Event("load"));
  });
}

/** Plays Google for a site key other than the first, whose script is a separate tag. */
export async function finishScriptLoadFor(key: string) {
  const selector = `script[src*="render=${encodeURIComponent(key)}"]`;
  await waitFor(() => expect(document.head.querySelector(selector)).not.toBeNull());
  await act(async () => {
    const api: Grecaptcha = { ready: (cb) => cb(), execute: execute as Grecaptcha["execute"] };
    window.grecaptcha = api;
    document.head.querySelector(selector)?.dispatchEvent(new Event("load"));
  });
}

/** Lets the promises started by the last step settle, and the effects they cause run. */
export const tick = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

/** Lets a renewal scheduled with a timeout of 0, and any follow-up, run with real timers. */
export const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

/**
 * Moves fake time forward by `ms`, then lets what that step started settle. Advance to the
 * exact moment of a timer, not past it, so a retry is scheduled from that moment.
 */
export async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await tick();
}

export class FakeIntersectionObserver {
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
