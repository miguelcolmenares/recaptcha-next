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

## Check the action and the hostname

Google returns the action and the hostname the token was made for. Pass `expectedAction` and `expectedHostname` so a token made for another form or another site is refused, with `action-mismatch` or `hostname-mismatch`.

## Retry after a refusal

A token works once. Google spends it on the first check, so a second check with the same token is refused. Google reports that as `rejected-by-google`, and the usual code is `timeout-or-duplicate`.

When the browser builds the form's data for a submit, `RecaptchaField` asks for a new token. The new one is ready a moment later, so a visitor who was refused can send the form again without reloading the page. A canceled submit, such as one stopped by validation, renews nothing. The timer still renews the token every 90 seconds. A field outside a `<form>` renews on the timer only. The field asks for a token only when one was spent, so reading the form while it is already empty or while a request is in flight asks for nothing, and a `formdata` event from another form, including one nested inside this one, is ignored.

Reading the form with `new FormData(form)` also fires that event, so it renews the token too, and the token in that `FormData` is the one that was spent. Read the form once, at submit time, and send that same `FormData`. A `FormData` built later, after the renewal, carries the new token, but the first one is no longer valid.

The package owns this lifecycle. Keep `RecaptchaField` mounted; a changing `key`, local reset hook
or manual hidden-token copy is unnecessary. Upgrade an older version rather than recreating renewal
in the application.

## What is retried

The package retries script loading and token generation. It does not replay a failed verification
request or resubmit the Server Action, message, lead or payment. After a refusal, the visitor submits
again with the field's new token; the application handles its own business operation once.

- Script loading, including `grecaptcha.ready`, has a 15-second deadline per attempt.
- `RecaptchaField` token generation has a ten-second deadline. Failed attempts wait 5, 10, 20 and
  then 30 seconds between retries, returning to the first wait after success.
- The default server's request to Google has a five-second deadline, including its response body.
  Failure returns `request-failed` without another request using the same token.

See [Client API](api-client.md) for the lower-level `useRecaptcha` contract.

## Refusal reasons

`verifyRecaptcha` returns one of these reasons when it refuses. Show the visitor a message that says what to do next. The default verifier records the reason in its own failure log.

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

When investigating unexpected scores, compare these contexts with the package's refusal records:

- browser storage and privacy settings,
- VPN or proxy use,
- new browser profiles.

These are diagnostic contexts, not proof of the cause of an individual refusal. Google notes that
scores in staging or a new implementation may differ from production; test scores can also be
inaccurate without real traffic. Use the site's actual traffic when choosing thresholds. See
[reCAPTCHA v3 guidance](https://developers.google.com/recaptcha/docs/v3) and the
[testing FAQ](https://developers.google.com/recaptcha/docs/faq/).

### Read the package's failure records

The default `verifyRecaptcha` records every refused check once as
`[recaptcha-next] verification failed`, with `reason`, `score` and `errorCodes`. It excludes the token,
secret and form fields. Applications consume the typed result and show their own visitor message;
they do not need to duplicate the failure record.

```ts
const result = await verifyRecaptcha(getRecaptchaToken(formData), { expectedAction: "contact" });
if (!result.success) {
  return { success: false, reason: result.reason };
}
```

Custom verifiers built with `createVerifyRecaptcha` return the same typed results and leave
observation to their caller. That advanced factory does not use the default logger. Never include
a token or secret in custom logs. Google's list of error codes is in its siteverify documentation.

### Tune minScore

Start with the default. Review the scores in the package's refusal records for a while. If real visitors who go on to complete the form score below the threshold, lower `minScore` for that form. Raise it for a form where spam costs more, such as a form that starts a sales process.

## The console message

`requestStorageAccess: Permission denied` in the browser console comes from the reCAPTCHA iframe, which is Google's code. It is not the cause of a refusal. The reason and the error codes on the server show what happened.

## When the secret is missing

A missing token always returns `missing-token`, before the secret is checked.
With a present token, a missing secret returns `missing-secret` unless
`NODE_ENV` is exactly `"development"` or `"test"`. Only those modes allow a skip
with a warning. An absent variable, an empty value or `"staging"` requires the secret.

`isRecaptchaEnabled()` describes the secret policy; it is not a replacement for verification.
Always call `verifyRecaptcha` in the action, as shown above. Guarding that call with
`isRecaptchaEnabled()` would also bypass the missing-token check in an unconfigured development
environment.
