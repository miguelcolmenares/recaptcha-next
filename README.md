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
// app/contact-form/index.tsx
"use client";

import { useActionState } from "react";
import { RecaptchaField } from "recaptcha-next/client";
import { sendMessage } from "../actions";
import type { SubmitState } from "../actions";

const initialState: SubmitState = { success: null, reason: null };

export default function ContactForm() {
  const [state, formAction, pending] = useActionState(sendMessage, initialState);
  return (
    <form action={formAction}>
      <input name="message" />
      <RecaptchaField action="contact" />
      <button type="submit" disabled={pending}>
        Send
      </button>
      {state.success === false && <p role="alert">Could not verify your visit. Try again.</p>}
    </form>
  );
}
```

Verify the token in the Server Action, with the same `action` name.

```ts
// app/actions.ts
"use server";

import { getRecaptchaToken, verifyRecaptcha } from "recaptcha-next/server";
import type { VerificationFailureReason } from "recaptcha-next/server";

export interface SubmitState {
  success: boolean | null;
  reason: VerificationFailureReason | null;
}

export async function sendMessage(
  _previous: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const result = await verifyRecaptcha(getRecaptchaToken(formData), { expectedAction: "contact" });
  if (!result.success) return { success: false, reason: result.reason };
  // Handle the message only after verification succeeds.
  return { success: true, reason: null };
}
```

## Retry after a refusal

A token works once. When the browser builds the form's data for a submit, `RecaptchaField` asks for a new token,
so a visitor who was refused can send the form again. A canceled submit renews nothing. Reading the form with
`new FormData(form)` also renews it, so read it once, at submit time. Only a spent token is renewed: reading an empty
field, or one with a request in flight, asks for nothing. Outside a `<form>` the field renews on its timer only.
The package owns renewal; consumers do not need a changing `key` or a local reset hook.

| Reason               | Meaning                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `low-score`          | Google scored the visit below `minScore` (default `0.5`).             |
| `rejected-by-google` | Google did not accept the token. `errorCodes` says why.               |
| `action-mismatch`    | The token was made for another action than `expectedAction`.          |
| `hostname-mismatch`  | The token was made on another hostname than `expectedHostname`.       |
| `missing-token`      | The form had no token yet, usually because the script has not loaded. |
| `missing-secret`     | The server requires `RECAPTCHA_SECRET_KEY` and has none.              |
| `request-failed`     | The request to Google failed.                                         |
| `invalid-score`      | Google returned no finite score from 0 through 1.                     |

The default `verifyRecaptcha` logs failed checks with `reason`, `score` and `errorCodes`. It never
logs the token, secret or form fields. Custom verifiers built with `createVerifyRecaptcha` return
the same typed failures and leave logging to their caller.

Investigate unexpected scores using the package's refusal records. Browser privacy settings, VPN use
and new profiles are contexts to compare, not proof of the cause of a refusal. Tune `minScore` from
real site traffic, as [Google recommends](https://developers.google.com/recaptcha/docs/v3); test scores
can differ without real traffic ([FAQ](https://developers.google.com/recaptcha/docs/faq/)). Do not add
a second failure log around the default verifier. The message `requestStorageAccess: Permission denied` in the console
comes from Google's iframe and is not the cause of a refusal. See the [server actions guide](https://miguelcolmenares.com/recaptcha-next/docs/server-actions/)
for the full table and examples.

The package retries script loading and token generation, not Server Action execution or business
submissions. The default server waits at most five seconds for Google and returns `request-failed`
on a transport failure; it never rechecks a spent token automatically.

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
| `refreshIntervalMs` | `90000`                          | Delay before token renewal, capped at 110 seconds.                                                     |
| `onTokenGenerated`  |                                  | Called with each new token, already in the hidden input. Throws log the prop name only.                |
| `onError`           |                                  | Called on each failed script load, token or renewal. Failures are retried, each attempt reported once. |

A thrown consumer callback is reported with its prop name only. The package never writes its thrown
value, message, stack or callback argument to the console.

`useRecaptcha({ action, siteKey?, enabled? })` returns `{ status, error, execute }`.
Use it only for a payload without a form element. The field remains the standard form integration.
The hook retries script loads but does not add the field's token expiry, renewal, request deadline
or generation retry around `execute()`. See [Client API](https://miguelcolmenares.com/recaptcha-next/docs/api-client/).

### `recaptcha-next/server`

- `verifyRecaptcha(token, options?)` returns a `VerificationResult`, it does not throw.
  Options: `minScore` (default `0.5`), `expectedAction`, `expectedHostname`, `secret`, `remoteIp`.
- `getRecaptchaToken(formData, field?)` returns the token or `null`.
- `isRecaptchaEnabled()` reports the runtime secret-configuration policy. It returns
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
`isProduction` policy, where `true` enforces a configured secret. A missing token is always rejected
before checking that secret. Use `isRecaptchaEnabled()` for configuration diagnostics, not to guard
the verification call.

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
Each load attempt, including a fresh tag and its readiness callback, has a 15-second deadline.
An error or timeout rejects the load, without using another key's global. A tag whose load finishes
without the API or a usable readiness function is removed, so retrying can load a fresh script. Timed-out tags stay
available for a late load or readiness callback, so retrying does not add duplicate scripts.
Already-finished, unmarked tags time out because their load event cannot repeat.

## Custom `FormData`

Use `new FormData(form)` when a form element exists, then normalize its values or remove unwanted
files before sending that same payload. The token is included and its renewal stays in the package.
See [Custom FormData](https://miguelcolmenares.com/recaptcha-next/docs/custom-formdata/) for examples.

For a payload without a form element, `useRecaptcha().execute()` provides a fresh token for each attempt:

```ts
formData.set("g-recaptcha-response", await execute());
```

## Development

Source and test names use kebab-case. Each layer exposes a barrel, and cross-layer imports use
the `@/` alias for `src/`. Components use a folder with an `index.tsx` and a default export;
the public `recaptcha-next/client` exports remain named.

`src/presentation/recaptcha-field/index.tsx` renders the field and wires its hooks.
The plain `token-renewal.ts` controller owns scheduling, expiry, retries and cancellation.
`use-token-renewal.ts` synchronizes React and the input; `use-lazy-visibility.ts` observes visibility;
`use-form-token-events.ts` subscribes to the enclosing form.
Tests live in `__tests__/` inside their owning layer or component, with integration suites in
`__tests__/integration/`. See [Testing](docs/testing.md) for the checks.

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
