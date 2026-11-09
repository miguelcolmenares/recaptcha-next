---
order: 1
---

# Getting started

Add reCAPTCHA v3 to a Next.js form in three steps: install the package, put a field in the form, and verify the token in a Server Action.

## Install

```bash
npm install recaptcha-next
```

It needs React 19 and Node 22 or newer.

## Create the keys

Create a reCAPTCHA **v3** key pair in the [admin console](https://www.google.com/recaptcha/admin). Add your production domain and `localhost` to its domains, then put both keys in the environment.

```bash
# .env.local
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=your-site-key
RECAPTCHA_SECRET_KEY=your-secret-key
```

The site key is public and is read in the browser. The secret key stays on the server and is never part of the browser bundle.

## Add the field

`RecaptchaField` renders a hidden input named `g-recaptcha-response` and keeps a fresh token in it.

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

## Verify the token

Read the token from the `FormData` and check it with the same `action` name.

```ts
// app/actions.ts
"use server";

import { getRecaptchaToken, verifyRecaptcha } from "recaptcha-next/server";

export async function sendMessage(formData: FormData) {
  const result = await verifyRecaptcha(getRecaptchaToken(formData), { expectedAction: "contact" });
  if (!result.success) {
    return { error: result.reason };
  }
  // ...handle the message
}
```

`verifyRecaptcha` never throws. It returns a [result](api-server.md) you can switch on.

A token works once. If the check refuses a submit, the visitor can send the form again, because the field renews its token after each submit. See [Server Actions](server-actions.md) for the refusal reasons and what to show the visitor.

## Next steps

- [Server Actions](server-actions.md) for the full flow with `useActionState`.
- [Lazy loading](lazy-loading.md) to keep Google's script off pages until the form is near.
- [Testing](testing.md) to verify without calling Google.
