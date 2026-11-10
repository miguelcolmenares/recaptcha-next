---
order: 5
---

# Custom FormData

## Start from the form

For a form, use the [standard Server Action integration](server-actions.md). React builds the
`FormData` from the form's fields, including `RecaptchaField`, and the package owns token renewal.

If an existing submit handler needs to normalize values or omit empty files, construct
`new FormData(form)` once, normalize that same payload, and send it to the action. Do not rebuild
it from React state or copy the hidden input manually. Both reading the form and submitting it
fire `formdata`, so constructing a second payload can read an empty or different token.

Do not add a changing `key`, local reset hook, timer or Google-response classifier. Keep the field
mounted and consume the verifier's typed result. The package does not replay the Server Action or
business submission after a failure; the visitor starts another attempt with the new token.

## Payloads without a form element

Use `useRecaptcha` only when no form element supplies the payload. Wait for `status === "ready"`,
then await `execute()` for a fresh token before each attempt and send it in the payload's
`g-recaptcha-response` field. Handle a rejected promise in the UI without reusing a previous token.
See [Client API](api-client.md) for the hook's lower-level lifecycle and deadline limits.

The server side uses the same `getRecaptchaToken(formData)` and `verifyRecaptcha` functions.
Pass a second argument to `getRecaptchaToken` if the field has a different name.
