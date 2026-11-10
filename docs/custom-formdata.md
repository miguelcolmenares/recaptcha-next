---
order: 5
---

# Custom FormData

## Start from the form

When a form element exists, use `new FormData(form)`. It includes the hidden token and triggers the
package's automatic renewal. Normalize fields or remove unwanted files from that same `FormData`
before sending it to the Server Action. Sending it with `fetch` works the same way; the transport
does not change which fields the browser captured.

```tsx
"use client";

import type { FormEvent } from "react";
import { RecaptchaField } from "recaptcha-next/client";
import { sendMessage } from "./actions";

export function ContactForm() {
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("message", String(formData.get("message") ?? "").trim());
    await sendMessage(formData);
  }

  return (
    <form onSubmit={onSubmit}>
      <RecaptchaField action="contact" />
      <input name="message" />
      <button type="submit">Send</button>
    </form>
  );
}
```

Do not copy the hidden input by hand or remount the field after a response. The package requests
the next token. Read the form once per attempt and send that captured payload.

## Payloads without a form element

If no form element supplies the payload, ask for a fresh token at submit time with `useRecaptcha`
and add it to the payload. This hook exposes the package's token generation directly.

```tsx
"use client";

import { useRecaptcha } from "recaptcha-next/client";
import { sendMessage } from "./actions";

export function ProgrammaticRequest() {
  const { status, execute } = useRecaptcha({ action: "contact" });

  async function send() {
    const formData = new FormData();
    formData.set("message", "hello");
    formData.set("g-recaptcha-response", await execute());
    await sendMessage(formData);
  }

  return (
    <button type="button" onClick={send} disabled={status !== "ready"}>
      Send
    </button>
  );
}
```

The server side is the same as for a normal form: `getRecaptchaToken(formData)` reads the `g-recaptcha-response` field. Pass a second argument to `getRecaptchaToken` if you named the field differently.

`execute()` makes a new token each time it is called, so a token is never reused between submits.
