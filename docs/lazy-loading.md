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

## What a visitor sees

Until the script loads there is no token, so a very fast submit can happen before one exists. The server then answers with `missing-token`. Show that reason as "try again" in the form, or use [`useRecaptcha`](api-client.md) and disable the button until its status is `ready`.

A submit before the field is visible, such as a `form.requestSubmit()` in your code, loads the script. That first submit goes out without a token, so only the next submit carries one.

## Token refresh

Google tokens last two minutes. The field replaces its token every `refreshIntervalMs`, which is 90 seconds by default, so a visitor who takes a while to fill the form still submits a valid one. The field also asks for a new token when the browser builds the form's data for a submit, so a retry after a refusal has a fresh one. See [Server Actions](server-actions.md).

## One script per page

The script is loaded once per site key and is not removed when the field unmounts. See [Navigation](navigation.md) for why.
