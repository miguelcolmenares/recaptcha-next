import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { GOOGLE_SCRIPT, hasRealKeys, result, stubGoogle, tokenInput } from "./support";

const TOKEN_TIMEOUT = 20_000;

/** The parsed `SubmitState` the fixture prints after a Server Action finishes. */
async function submitState(page: Page) {
  await expect(result(page)).not.toHaveText(/"tokenReceived":false/, { timeout: TOKEN_TIMEOUT });
  return JSON.parse((await result(page).textContent()) ?? "{}") as {
    tokenReceived: boolean;
    success: boolean | null;
    reason: string | null;
    score: number | null;
    hostname: string | null;
  };
}

// Real Google is the point of this file: a Server Action in Next gets a real token, calls the
// real siteverify endpoint, and the verification ends in success.
test.describe("Server Action with real Google", () => {
  test.skip(!hasRealKeys, "Set NEXT_PUBLIC_RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY to run.");

  test("hidden input to <form action>: verification succeeds", async ({ page }) => {
    await page.goto("/");
    await expect(tokenInput(page)).not.toHaveValue("", { timeout: TOKEN_TIMEOUT });
    await page.getByRole("button", { name: "Send" }).click();

    const state = await submitState(page);
    expect(state).toMatchObject({
      tokenReceived: true,
      success: true,
      reason: null,
      hostname: "localhost",
    });
    expect(state.score).toBeGreaterThanOrEqual(0);
    expect(state.score).toBeLessThanOrEqual(1);
  });

  test("useRecaptcha().execute() with a hand-made FormData: verification succeeds", async ({
    page,
  }) => {
    await page.goto("/programmatic");
    await expect(page.getByTestId("status")).toHaveText("ready", { timeout: TOKEN_TIMEOUT });
    await page.getByRole("button", { name: "Send programmatically" }).click();

    expect(await submitState(page)).toMatchObject({
      tokenReceived: true,
      success: true,
      reason: null,
      hostname: "localhost",
    });
  });

  test("the same Server Action keeps working after a soft navigation", async ({ page }) => {
    await page.goto("/");
    await expect(tokenInput(page)).not.toHaveValue("", { timeout: TOKEN_TIMEOUT });
    await page.getByRole("link", { name: "Programmatic", exact: true }).click();
    await expect(page.getByTestId("status")).toHaveText("ready", { timeout: TOKEN_TIMEOUT });
    await page.getByRole("button", { name: "Send programmatically" }).click();

    expect(await submitState(page)).toMatchObject({ tokenReceived: true, success: true });
  });
});

// Without keys or network these still prove the wiring: the token reaches the Server Action
// and Google's rejection of a made-up token comes back as a typed result, not a crash.
test.describe("Server Action with a stubbed Google script", () => {
  test.beforeEach(async ({ page }) => {
    await stubGoogle(page);
  });

  test("hidden input: the action receives the token and rejects the fake one", async ({ page }) => {
    await page.goto("/");
    await expect(tokenInput(page)).toHaveValue(/^stub-token:.+:contact$/);
    await page.getByRole("button", { name: "Send" }).click();

    expect(await submitState(page)).toMatchObject({ tokenReceived: true, success: false });
  });

  test("execute(): the action receives the token and rejects the fake one", async ({ page }) => {
    await page.goto("/programmatic");
    await expect(page.getByTestId("status")).toHaveText("ready");
    await page.getByRole("button", { name: "Send programmatically" }).click();

    expect(await submitState(page)).toMatchObject({ tokenReceived: true, success: false });
  });
});

// Each token from this stub is new, so the test can tell a renewed token from the spent one.
test.describe("Retry after a refused submit, with a numbered stub", () => {
  test("the field asks for a new token after each refused submit", async ({ page }) => {
    await page.route(GOOGLE_SCRIPT, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `(function () {
          var issued = 0;
          window.grecaptcha = {
            ready: function (cb) { cb(); },
            execute: function () { issued += 1; return Promise.resolve("stub-token:" + issued); }
          };
        })();`,
      }),
    );

    await page.goto("/");
    await expect(tokenInput(page)).toHaveValue("stub-token:1");
    await page.getByRole("button", { name: "Send" }).click();
    expect(await submitState(page)).toMatchObject({ tokenReceived: true, success: false });
    await expect(tokenInput(page)).not.toHaveValue("stub-token:1");

    const second = await tokenInput(page).inputValue();
    await page.getByRole("button", { name: "Send" }).click();
    await expect(tokenInput(page)).not.toHaveValue(second);
  });
});
