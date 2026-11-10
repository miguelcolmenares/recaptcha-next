import { expect, test } from "@playwright/test";
import { GOOGLE_SCRIPT, scriptCount, stubGoogle, tokenInput } from "./support";

const fixtureKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "fixture-site-key";
const endpoint = new URL("https://www.google.com/recaptcha/api.js");
endpoint.searchParams.set("render", fixtureKey);
const fixtureScript = endpoint.href;

test("a completed layout loader is reused when its element records successful loading", async ({
  page,
}) => {
  const requests = await stubGoogle(page);
  await page.goto("/plain");
  const element = await page.addScriptTag({ url: fixtureScript });
  // addScriptTag resolves after this element's load; the marker now has evidence.
  await element.evaluate((script) => {
    if (!(script instanceof HTMLScriptElement)) throw new Error("Expected a layout script element");
    script.dataset.recaptchaLoaded = "true";
  });

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(tokenInput(page)).toHaveValue(/^stub-token:.+:contact$/);
  expect(requests).toHaveLength(1);
  expect(await scriptCount(page)).toBe(1);
});

test("a prior resource fetch cannot initialize a pending layout script", async ({ page }) => {
  let allowExecution = () => {};
  const responseGate = new Promise<void>((resolve) => {
    allowExecution = resolve;
  });
  await page.route(GOOGLE_SCRIPT, async (request) => {
    if (request.request().resourceType() === "fetch") {
      await request.fulfill({
        headers: { "access-control-allow-origin": "*", "timing-allow-origin": "*" },
        body: "// earlier download, not script execution",
      });
      return;
    }
    await responseGate;
    await request.fulfill({
      contentType: "application/javascript",
      body: `window.grecaptcha = {
        ready: callback => callback(),
        execute: (key, options) => Promise.resolve('stub-token:' + key + ':' + options.action)
      };`,
    });
  });

  try {
    await page.goto("/plain");
    await page.evaluate(async (url) => {
      const earlierResponse = await fetch(url);
      await earlierResponse.text();
    }, fixtureScript);
    await expect
      .poll(() => page.evaluate((url) => performance.getEntriesByName(url).length, fixtureScript))
      .toBeGreaterThan(0);

    const pendingRequest = page.waitForRequest(
      (request) => request.resourceType() === "script" && request.url() === fixtureScript,
    );
    await page.evaluate((url) => {
      window.grecaptcha = {
        ready: (callback) => callback(),
        execute: async () => {
          document.documentElement.dataset.wrongKeyExecuted = "true";
          throw new Error("The requested key is still loading");
        },
      };
      const loader = document.createElement("script");
      loader.src = url;
      document.head.appendChild(loader);
    }, fixtureScript);
    await pendingRequest;
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(tokenInput(page)).toBeAttached();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(tokenInput(page)).toHaveValue("");
    await expect(page.locator("html")).not.toHaveAttribute("data-wrong-key-executed", "true");
    expect(await scriptCount(page)).toBe(1);
  } finally {
    allowExecution();
  }

  await expect(tokenInput(page)).toHaveValue(/^stub-token:.+:contact$/);
});
