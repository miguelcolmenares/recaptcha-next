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
| `refreshIntervalMs` | `90000`                          | Time between token refreshes. Google tokens last two minutes.                                          |
| `onTokenGenerated`  |                                  | Called with each new token, already in the hidden input. Inline functions are safe.                    |
| `onError`           |                                  | Called on each failure: the script, a token or a renewal. Failed renewals repeat with a growing delay. |

A token works once. When the browser builds the form's data for a submit (the `formdata` event), the field asks for a
new token, and the timer keeps renewing it. A canceled submit renews nothing. Reading the form with
`new FormData(form)` also renews it, so read it once, at submit time. A field outside a `<form>` renews on the timer
only. A failed token request is retried after 5 seconds, then after 10, 20 and 30 seconds, and a token is cleared when
its two minutes pass. See [Server Actions](server-actions.md) for retries after a refusal.

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

Use it when you build the `FormData` yourself. See [Custom FormData](custom-formdata.md).
