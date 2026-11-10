# Contact form

A form that verifies a visitor with a Server Action and shows the result. This is the shape the package is tested with in a real Next.js app.

## The form

```tsx
// app/contact-form/index.tsx
"use client";

import { useActionState } from "react";
import { RecaptchaField } from "recaptcha-next/client";
import { submitAction } from "../actions";
import type { SubmitState } from "../actions";

const initialState: SubmitState = { success: null, reason: null };

export default function ContactForm({ lazy = false }: { lazy?: boolean }) {
  const [state, formAction] = useActionState(submitAction, initialState);
  return (
    <form action={formAction}>
      <input name="message" />
      <RecaptchaField action="contact" lazy={lazy} />
      <button type="submit">Send</button>
      {state.success === false && <p role="alert">{state.reason}</p>}
    </form>
  );
}
```

## The Server Action

```ts
// app/actions.ts
"use server";

import { getRecaptchaToken, verifyRecaptcha } from "recaptcha-next/server";
import type { VerificationFailureReason } from "recaptcha-next/server";

export interface SubmitState {
  success: boolean | null;
  reason: VerificationFailureReason | null;
}

export async function submitAction(_previous: unknown, formData: FormData): Promise<SubmitState> {
  const result = await verifyRecaptcha(getRecaptchaToken(formData), {
    expectedAction: "contact",
    expectedHostname: "example.com",
  });
  return { success: result.success, reason: result.success ? null : result.reason };
}
```

Pass `lazy` to wait for the viewport, see [Lazy loading](../../docs/lazy-loading.md). The environment needs `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` and `RECAPTCHA_SECRET_KEY`.
