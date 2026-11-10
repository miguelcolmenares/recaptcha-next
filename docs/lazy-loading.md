---
order: 3
---

# Lazy loading

Google's script is heavy, and a form far down the page may never be reached. With `lazy`, the script waits until the form is near the viewport.

```tsx
<RecaptchaField action="contact" lazy />
```

`lazyRootMargin` sets how early loading starts. It is `200px` by default, so the script begins loading when the form is 200 pixels from the screen.

```tsx
<RecaptchaField action="contact" lazy lazyRootMargin="600px" />
```

Setting `lazy` to `false` starts loading immediately, even before the form becomes visible.
Once loading has been requested, changing it back to `true` does not cancel the load or stop renewal.

## What a visitor sees

Until the script loads there is no token, so a very fast submit can happen before one exists. The server then answers with `missing-token`. Show a "wait a moment and try again" message in the form and keep the field mounted.
For forms, keep `RecaptchaField` as the lifecycle owner rather than adding a second hook to manage its token.

A submit before the field is visible, such as a `form.requestSubmit()` in your code, loads the script. That first submit goes out without a token, so only the next submit carries one.

If the script fails to load, the field tries again after 5, 10, 20 and then 30 seconds, and reports each failed attempt to `onError`. A site key that is not there at mount, for example one that arrives in a prop later, does not turn lazy loading off: the field waits for the key, and then for the form to come near the viewport.

## Token refresh

Google tokens last two minutes. The field schedules renewal after `refreshIntervalMs`, 90 seconds by default and capped at 110 seconds. A slow or failed renewal can leave the input empty; a token is removed when its two-minute lifetime ends. The field also asks for a new token when the browser builds the form's data for a submit, so a retry after a refusal has a fresh one. See [Server Actions](server-actions.md).

## One script per page

The script is loaded once per site key and is not removed when the field unmounts. See [Navigation](navigation.md) for why.
