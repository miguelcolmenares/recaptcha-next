---
order: 7
---

# Client API

Everything in `recaptcha-next/client`. These run in the browser, in Client Components.

## `RecaptchaField`

Renders a hidden input and keeps a fresh token in it.

| Prop                | Default                          | Description                                                                                            |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `action`            | required                         | Action name. Check the same name on the server.                                                        |
| `siteKey`           | `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | Public site key. Without a key the field renders nothing.                                              |
| `name`              | `g-recaptcha-response`           | Name of the hidden input.                                                                              |
| `lazy`              | `false`                          | Load Google's script only when the form is near the viewport.                                          |
| `lazyRootMargin`    | `200px`                          | How early lazy loading starts.                                                                         |
| `refreshIntervalMs` | `90000`                          | Delay before token renewal, capped at 110 seconds.                                                     |
| `onTokenGenerated`  |                                  | Called with each new token, already in the hidden input. A throw is logged, not rethrown.              |
| `onError`           |                                  | Called on each failed script load, token or renewal. Failures are retried, each attempt reported once. |

Changing `lazy` from `true` to `false` starts loading immediately. Re-enabling lazy mode does not
cancel a load that was already requested.

A token works once. When the browser builds the form's data for a submit (the `formdata` event), the field drops the
token it held and asks for a new one, and the timer keeps renewing it. It asks only when a token was spent. Reading an
empty field, or reading while a request is already in flight, asks for nothing, so a failing renewal keeps its
backoff. A canceled submit renews nothing, and a `formdata` event from another form, even one nested inside this one,
is ignored. Reading the form with `new FormData(form)` also fires the event, so read it once, at submit time. A field
outside a `<form>` renews on the timer only. A change of `refreshIntervalMs` applies from the next refresh.
The delay is capped at 110 seconds, so renewal starts at least 10 seconds before expiry.
A slow or failed renewal can still leave the field empty until a later request succeeds.
If a replacement arrives before a pending renewal runs, it is kept while unspent; reading that replacement
still results in a renewal. Changing the key or unmounting cancels the pending request deadline.

A failed token request is retried after 5 seconds, then after 10, 20 and 30 seconds. A failed script load is retried
with the same waits, until it works, the site key changes or the field unmounts, and a new key starts again at 5
seconds. A token is cleared when its two minutes pass, and when `action` or `siteKey` changes, so going from one to
another and back never shows the old token. `onTokenGenerated` and `onError` run after the field has updated its own
state and timers, and one that throws is logged with `console.error` and ignored. See
[Server Actions](server-actions.md) for retries after a refusal.

## `useRecaptcha`

```ts
const { status, error, execute } = useRecaptcha({ action: "contact" });
```

Options are `action`, `siteKey` and `enabled`. It returns:

| Value     | Description                                                                 |
| --------- | --------------------------------------------------------------------------- |
| `status`  | `idle`, `loading`, `ready` or `error`.                                      |
| `error`   | The error when the status is `error`, otherwise `null`.                     |
| `execute` | Returns a promise of a fresh token. Call it when the user submits the form. |

Use `RecaptchaField` with `new FormData(form)` for an existing form. Use this hook when a payload
has no form element. See [Custom FormData](custom-formdata.md).
