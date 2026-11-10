/**
 * Read the public site key from the environment.
 * The member expression must stay literal: bundlers replace `process.env.NEXT_PUBLIC_*`
 * only when they can see the full name, so a computed lookup would come back empty in the browser.
 */
export function readSiteKey(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || undefined;
  } catch {
    return undefined;
  }
}
