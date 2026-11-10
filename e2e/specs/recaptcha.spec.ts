import { expect, test } from "@playwright/test";
import { GOOGLE_SCRIPT, hasRealKeys, result, stubGoogle, tokenInput } from "./support";

// The stub echoes the site key the fixture was built with, so match the shape, not the key.
const STUB_TOKEN = /^stub-token:.+:contact$/;

test.describe("with a stubbed Google script", () => {
  test("a Server Component can import the root entry", async ({ page }) => {
    await stubGoogle(page);
    await page.goto("/");
    await expect(page.getByTestId("min-score")).toHaveText("0.5");
  });

  test("the token reaches the hidden input and then the Server Action", async ({ page }) => {
    await stubGoogle(page);
    await page.goto("/");

    await expect(tokenInput(page)).toHaveValue(STUB_TOKEN);
    await page.getByRole("button", { name: "Send" }).click();

    // A made-up token is never valid, but the server must have received it.
    await expect(result(page)).toContainText('"tokenReceived":true');
    await expect(result(page)).toContainText('"success":false');
  });

  test("a script response without an API is replaced on the automatic retry", async ({ page }) => {
    await page.clock.install();
    let requests = 0;
    await page.route(GOOGLE_SCRIPT, (route) => {
      requests += 1;
      return route.fulfill({
        contentType: "application/javascript",
        body:
          requests === 1
            ? "// no reCAPTCHA API supplied"
            : `window.grecaptcha = {
          ready: callback => callback(),
          execute: () => Promise.resolve("recovered-token")
        };`,
      });
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(tokenInput(page)).toHaveValue("");
    await expect(page.locator('script[src*="recaptcha/api.js"]')).toHaveCount(0);
    expect(requests).toBe(1);

    await page.clock.fastForward(5_001);
    await expect(tokenInput(page)).toHaveValue("recovered-token");
    await expect(page.locator('script[src*="recaptcha/api.js"]')).toHaveCount(1);
    expect(requests).toBe(2);
  });

  test("a long refresh interval renews before the token expires", async ({ page }) => {
    await page.clock.install();
    await page.route(GOOGLE_SCRIPT, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `let issued = 0;
        window.grecaptcha = {
          ready: function (callback) { callback(); },
          execute: function () { return Promise.resolve("token-" + ++issued); }
        };`,
      }),
    );
    await page.goto("/long-refresh");
    await expect(tokenInput(page)).toHaveValue("token-1");
    await page.clock.fastForward(110_001);
    await expect(tokenInput(page)).toHaveValue("token-2");
  });

  test("readiness has a deadline and a late callback is reused by the retry", async ({ page }) => {
    await page.clock.install();
    await page.route(GOOGLE_SCRIPT, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `var waiting = [];
        window.releaseReady = function () { waiting.splice(0).forEach(function (cb) { cb(); }); };
        window.grecaptcha = {
          ready: function (callback) { waiting.push(callback); },
          execute: function () { return Promise.resolve("recovered-token"); }
        };`,
      }),
    );
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(tokenInput(page)).toHaveValue("");
    await page.clock.fastForward(15_001);
    await page.evaluate(() => (window as unknown as { releaseReady: () => void }).releaseReady());
    // The timed-out attempt cannot issue a token. The retry reuses its completed registration.
    await expect(tokenInput(page)).toHaveValue("");
    await page.clock.fastForward(5_001);
    await expect(tokenInput(page)).toHaveValue("recovered-token");
    await expect(page.locator('script[src*="recaptcha/api.js"]')).toHaveCount(1);
  });

  test("disabling lazy loading starts an offscreen field and enabling it again keeps the token", async ({
    page,
  }) => {
    const requests = await stubGoogle(page);
    await page.goto("/lazy-toggle");
    await page.waitForLoadState("networkidle");
    expect(requests).toHaveLength(0);
    await expect(tokenInput(page)).toHaveValue("");

    await page.getByRole("button", { name: "Load now" }).click();
    await expect(tokenInput(page)).toHaveValue(STUB_TOKEN);
    await page.getByRole("button", { name: "Enable lazy" }).click();
    await expect(tokenInput(page)).toHaveValue(STUB_TOKEN);
    expect(requests).toHaveLength(1);
  });

  test("lazy mode loads Google only after the form scrolls into view", async ({ page }) => {
    const requests = await stubGoogle(page);
    await page.goto("/lazy");
    await page.waitForLoadState("networkidle");
    expect(requests).toHaveLength(0);
    await expect(tokenInput(page)).toHaveValue("");

    await page.locator("form").scrollIntoViewIfNeeded();

    await expect.poll(() => requests.length).toBe(1);
    await expect(tokenInput(page)).toHaveValue(STUB_TOKEN);
  });
});

test.describe("with real Google keys", () => {
  test.skip(!hasRealKeys, "Set NEXT_PUBLIC_RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY to run.");

  test("Google issues a token and the server accepts the exchange", async ({ page }) => {
    await page.goto("/");
    await expect(tokenInput(page)).not.toHaveValue("", { timeout: 20_000 });

    await page.getByRole("button", { name: "Send" }).click();
    await expect(result(page)).toContainText('"tokenReceived":true');

    // The fixture accepts any score, so a real token must verify. Server Action coverage is in
    // serverAction.spec.ts; this only checks that nothing failed.
    await expect(result(page)).toContainText('"success":true');
  });
});
