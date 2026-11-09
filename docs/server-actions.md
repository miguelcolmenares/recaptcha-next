---
order: 2
---

# Server Actions

The token travels in the form data, so a Server Action can verify it without any extra request from the browser.

## The flow

1. `RecaptchaField` loads Google's script and writes a token into a hidden input.
2. The form is submitted to a Server Action, and the input is part of the `FormData`.
3. The action reads the token with `getRecaptchaToken` and checks it with `verifyRecaptcha`.

## A form with state

This is the pattern the package itself is tested with, using `useActionState` to show the result.

```tsx
// app/ContactForm.tsx
"use client";

import { useActionState } from "react";
import { RecaptchaField } from "recaptcha-next/client";
import { submitAction } from "./actions";

export function ContactForm() {
  const [state, formAction] = useActionState(submitAction, { success: null, reason: null });
  return (
    <form action={formAction}>
      <input name="message" />
      <RecaptchaField action="contact" />
      <button type="submit">Send</button>
      {state.success === false && <p role="alert">Could not verify you: {state.reason}</p>}
    </form>
  );
}
```

```ts
// app/actions.ts
"use server";

import { getRecaptchaToken, verifyRecaptcha } from "recaptcha-next/server";

export async function submitAction(_previous: unknown, formData: FormData) {
  const result = await verifyRecaptcha(getRecaptchaToken(formData), {
    expectedAction: "contact",
    expectedHostname: "example.com",
  });
  return { success: result.success, reason: result.success ? null : result.reason };
}
```

## Check the action and the hostname

Google returns the action and the hostname the token was made for. Pass `expectedAction` and `expectedHostname` so a token made for another form or another site is refused, with `action-mismatch` or `hostname-mismatch`.

## Retry after a refusal

A token works once. Google spends it on the first check, so a second check with the same token is refused. Google reports that as `rejected-by-google`, and the usual code is `timeout-or-duplicate`.

When the browser builds the form's data for a submit, `RecaptchaField` asks for a new token. The new one is ready a moment later, so a visitor who was refused can send the form again without reloading the page. A canceled submit, such as one stopped by validation, renews nothing. The timer still renews the token every 90 seconds. A field outside a `<form>` renews on the timer only. The field asks for a token only when one was spent, so reading the form while it is already empty or while a request is in flight asks for nothing, and a `formdata` event from another form, including one nested inside this one, is ignored.

Reading the form with `new FormData(form)` also fires that event, so it renews the token too, and the token in that `FormData` is the one that was spent. Read the form once, at submit time, and send that same `FormData`. A `FormData` built later, after the renewal, carries the new token, but the first one is no longer valid.

A version without this renewal needs the field to mount again after each server answer. Change its `key`, and the field asks for a new token:

```tsx
export function ContactForm() {
  const [state, formAction] = useActionState(submitAction, {
    success: null,
    reason: null,
    attempt: 0,
  });
  return (
    <form action={formAction}>
      <input name="message" />
      <RecaptchaField key={state.attempt} action="contact" />
      <button type="submit">Send</button>
    </form>
  );
}
```

The action then returns `attempt: previous.attempt + 1` with each answer.

## Refusal reasons

`verifyRecaptcha` returns one of these reasons when it refuses. Show the visitor a message that says what to do next, and keep the reason in your logs.

| Reason               | What it means                                                                      | What the visitor should see                                              |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `low-score`          | Google scored the visit below `minScore`. A real visitor can get this, see Scores. | "We could not verify your visit. Try again, or write to us another way." |
| `rejected-by-google` | Google did not accept the token. `errorCodes` says why.                            | The same retry message. The field renews, so a retry can work.           |
| `action-mismatch`    | The token was made for another action. Usually the `action` names differ.          | A generic "could not send, try again" message. Fix the code.             |
| `hostname-mismatch`  | The token was made on another domain. Usually a preview or staging host.           | A generic "could not send, try again" message. Fix the keys or the host. |
| `missing-token`      | The form had no token yet, because the script has not loaded.                      | "Wait a moment and try again."                                           |
| `missing-secret`     | The server has no `RECAPTCHA_SECRET_KEY` and requires one.                         | A generic error. This is a configuration error, so check the logs.       |
| `request-failed`     | The request to Google failed, for example a network error or a timeout.            | "Try again in a moment."                                                 |
| `invalid-score`      | Google sent no score, or one outside 0 through 1. Rare.                            | A generic error. Check the logs.                                         |

## Scores

Google scores each visit from 0 to 1. `verifyRecaptcha` rejects a score below `minScore`, which is `0.5` by default, with `low-score`. Decide on the value from your own traffic, not from a guess.

Malformed scores return `invalid-score` before threshold rules are applied.
The score must be a finite number from 0 through 1, including at `minScore: 0`.

### Why a real visitor can score low

Google scores the visit, not the person. A visitor can score below 0.5 when:

- the browser blocks third-party storage, as some privacy settings and private windows do,
- the visitor uses a VPN or a proxy,
- the browser profile is new, so Google has no history for it.

### Log the score and the error codes

The reason, the score and the error codes are not secret, so log them on every refusal. Never log the token.

```ts
const result = await verifyRecaptcha(getRecaptchaToken(formData), { expectedAction: "contact" });
if (!result.success) {
  console.warn("reCAPTCHA refused", {
    reason: result.reason,
    score: result.score,
    errorCodes: result.errorCodes,
  });
  return { success: false, reason: result.reason };
}
```

Google's list of error codes is in its siteverify documentation.

### Tune minScore

Start with the default. Log the scores of the refused visits for a while. If real visitors who go on to complete the form score below the threshold, lower `minScore` for that form. Raise it for a form where spam costs more, such as a form that starts a sales process.

## The console message

`requestStorageAccess: Permission denied` in the browser console comes from the reCAPTCHA iframe, which is Google's code. It is not the cause of a refusal. The reason and the error codes on the server show what happened.

## When the secret is missing

With the default server, a missing secret returns `missing-secret` unless
`NODE_ENV` is exactly `"development"` or `"test"`. Only those modes allow a skip
with a warning. An absent variable, an empty value or `"staging"` requires the secret.

`isRecaptchaEnabled()` follows the same policy. A guard using this helper therefore
cannot skip verification merely because a production or unknown environment has no secret.
