# recaptcha-next

Google reCAPTCHA v3 for React and Next.js. A client field that keeps a fresh token in a hidden input,
and a server function that checks the token with Google.

- Server Actions friendly: read the token from `FormData`, verify it, get a typed result.
- One shared script per site key, loaded once and kept for the life of the page, also across client-side navigation.
- Lazy loading: the Google script can wait until the form is near the viewport.
- Fails closed in production when the secret key is missing.
- ESM and CommonJS, full types, MIT license.

Documentation: <https://miguelcolmenares.com/recaptcha-next/>

## Install

```bash
npm install recaptcha-next
```

Requires React 19 and Node 22 or newer. Create a reCAPTCHA **v3** key pair in the
[admin console](https://www.google.com/recaptcha/admin) and add your domains (and `localhost` for development).

```bash
# .env.local
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=your-site-key
RECAPTCHA_SECRET_KEY=your-secret-key
```

## Use

Add the field to a form. It renders a hidden input named `g-recaptcha-response`.

```tsx
// app/ContactForm.tsx
"use client";

import { RecaptchaField } from "recaptcha-next/client";
import { sendMessage } from "./actions";

export function ContactForm() {
  return (
    <form action={sendMessage}>
      <input name="message" />
      <RecaptchaField action="contact" />
      <button type="submit">Send</button>
    </form>
  );
}
```

Verify the token in the Server Action, with the same `action` name.

```ts
// app/actions.ts
"use server";

import { getRecaptchaToken, verifyRecaptcha } from "recaptcha-next/server";

export async function sendMessage(formData: FormData) {
  const result = await verifyRecaptcha(getRecaptchaToken(formData), { expectedAction: "contact" });
  if (!result.success) {
    return { error: result.reason }; // "low-score", "action-mismatch", "missing-token", ...
  }
  // ...handle the message
}
```

## Retry after a refusal

A token works once. When the browser builds the form's data for a submit, `RecaptchaField` asks for a new token,
so a visitor who was refused can send the form again. A canceled submit renews nothing. Reading the form with
`new FormData(form)` also renews it, so read it once, at submit time. Outside a `<form>` the field renews on its
timer only. Older versions
need the field to mount again after each server answer: give `<RecaptchaField>` a `key` that changes.

| Reason               | Meaning                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `low-score`          | Google scored the visit below `minScore` (default `0.5`).             |
| `rejected-by-google` | Google did not accept the token. `errorCodes` says why.               |
| `action-mismatch`    | The token was made for another action than `expectedAction`.          |
| `hostname-mismatch`  | The token was made on another hostname than `expectedHostname`.       |
| `missing-token`      | The form had no token yet, usually because the script has not loaded. |
| `missing-secret`     | The server requires `RECAPTCHA_SECRET_KEY` and has none.              |
| `request-failed`     | The request to Google failed.                                         |

A real visitor can score below the default for a reason on their side: a browser that blocks third-party
storage, a VPN, or a new browser profile. Log `reason`, `score` and `errorCodes` on a refusal, never the token,
and tune `minScore` from your own logs. The message `requestStorageAccess: Permission denied` in the console
comes from Google's iframe and is not the cause of a refusal. See the [server actions guide](https://miguelcolmenares.com/recaptcha-next/docs/server-actions/)
for the full table and examples.

## API

### `recaptcha-next/client`

`<RecaptchaField />` props:

| Prop                | Default                          | Description                                                                                            |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `action`            | required                         | Action name. Check the same name on the server.                                                        |
| `siteKey`           | `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | Public site key. Without a key the field renders nothing.                                              |
| `name`              | `g-recaptcha-response`           | Name of the hidden input.                                                                              |
| `lazy`              | `false`                          | Load Google's script only when the form is near the viewport.                                          |
| `lazyRootMargin`    | `200px`                          | How early lazy loading starts.                                                                         |
| `refreshIntervalMs` | `90000`                          | Time between token refreshes. Google tokens last two minutes.                                          |
| `onTokenGenerated`  |                                  | Called with each new token, already in the hidden input. Inline functions are safe.                    |
| `onError`           |                                  | Called on each failure: the script, a token or a renewal. Failed renewals repeat with a growing delay. |

`useRecaptcha({ action, siteKey?, enabled? })` returns `{ status, error, execute }`.
Use it to get a fresh token at submit time instead of keeping a hidden input.

### `recaptcha-next/server`

- `verifyRecaptcha(token, options?)` returns a `VerificationResult`, it does not throw.
  Options: `minScore` (default `0.5`), `expectedAction`, `expectedHostname`, `secret`, `remoteIp`.
- `getRecaptchaToken(formData, field?)` returns the token or `null`.
- `isRecaptchaEnabled()` indicates whether verification is required. It returns
  `false` only in explicit development or test mode without a configured secret.
- `createVerifyRecaptcha(deps)` and `createGoogleVerifyGateway(options)` build a custom verifier, for tests or other runtimes.

Results distinguish three outcomes:

| Outcome  | Result fields                                                               |
| -------- | --------------------------------------------------------------------------- |
| Verified | `success: true`, `skipped: false`, `score`, `action`, `hostname`            |
| Skipped  | `success: true`, `skipped: true`, `reason: "missing-secret-in-development"` |
| Refused  | `success: false`, `reason`, optional `score` and `errorCodes`               |

Failure reasons: `missing-secret`, `missing-token`, `request-failed`, `rejected-by-google`,
`invalid-score`, `low-score`, `action-mismatch`, `hostname-mismatch`.

`invalid-score` rejects a missing score, a non-number, a non-finite number or a
number outside 0 through 1. `minScore: 0` still accepts a genuine score of zero.

**Missing secret.** The default server permits a missing secret only when
`NODE_ENV` is exactly `"development"` or `"test"`, and logs a warning when it skips.
Production, absent, empty and unknown values require the secret and return
`missing-secret` if it is unavailable. Custom verifiers use their injected
`isProduction` policy, where `true` enforces a configured secret.

### Root entry

`recaptcha-next` exports the constants, the result types and the pure `evaluateResponse` rule.
It has no React and no browser code, so it is safe in Server Components.

## Script lifetime

The Google script is loaded the first time a field needs it and is **not** removed when the field unmounts.
Google keeps its own state (the badge, iframes and extra scripts), and removing the tag does not reset it.
Each site key has its own script and promise, reused across mounts and navigation.
The badge therefore stays visible on pages that have no form after the first visit to one that does.
If you want the badge hidden, follow Google's rules for showing the reCAPTCHA branding text instead.

A script added by a layout is matched by its Google endpoint and `render` key.
An existing global alone does not initialize a different key. If your layout
finishes loading before the field mounts, mark that script after its load succeeds:

```html
<script
  src="https://www.google.com/recaptcha/api.js?render=YOUR_KEY"
  onload="this.setAttribute('data-recaptcha-loaded', 'true')"
></script>
```

For Next.js `<Script>`, set this attribute on the element from `onLoad` or
`onReady`. Set it only after successful loading, never as an initial attribute.
An unmarked existing tag must emit its own load event within 15 seconds.
An error or timeout rejects the load, without using another key's global.
Already-finished, unmarked tags time out because their load event cannot repeat.

## Custom `FormData`

If you build `FormData` by hand instead of passing the `<form>`, the hidden input is not included.
Read the token with `useRecaptcha().execute()` and append it yourself:

```ts
formData.set("g-recaptcha-response", await execute());
```

## Development

```bash
cp .env.example .env.local   # add a real v3 key pair, with "localhost" in its domains
npm test                     # unit and integration tests
npm run test:e2e             # packs the package, builds a Next.js app with it, runs Playwright
```

Tests that need a real key skip themselves when the keys are not set. In CI the keys come from the
repository secrets `RECAPTCHA_SITE_KEY` and `RECAPTCHA_SECRET_KEY`. Fork and Dependabot pull requests have no secrets,
so those tests skip there and everything else still runs.

## License

[MIT](LICENSE)
