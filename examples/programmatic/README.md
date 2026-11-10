# Programmatic token

A form that asks for a token when the visitor submits, and sends it in a `FormData` built by hand. Use this for custom `FormData` or a `fetch` call.

```tsx
// app/programmatic-form/index.tsx
"use client";

import type { FormEvent } from "react";
import { useRecaptcha } from "recaptcha-next/client";
import { submitAction } from "../actions";

export default function ProgrammaticForm() {
  const { status, execute } = useRecaptcha({ action: "contact" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("message", "hello");
    formData.set("g-recaptcha-response", await execute());
    await submitAction(null, formData);
  }

  return (
    <form onSubmit={onSubmit}>
      <p>{status}</p>
      <button type="submit" disabled={status !== "ready"}>
        Send programmatically
      </button>
    </form>
  );
}
```

There is no hidden input. The token is requested at submit time, so it is always fresh. The Server Action is the one from the [contact form example](../contact-form/README.md), and the [Custom FormData guide](../../docs/custom-formdata.md) explains the details.
