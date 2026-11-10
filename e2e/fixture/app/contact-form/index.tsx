"use client";

import { useActionState } from "react";
import { RecaptchaField } from "recaptcha-next/client";
import { submitAction } from "../actions";
import { initialState } from "../initial-state";

export default function ContactForm({
  lazy = false,
  refreshIntervalMs,
}: {
  lazy?: boolean;
  refreshIntervalMs?: number;
}) {
  const [state, formAction] = useActionState(submitAction, initialState);
  return (
    <form action={formAction}>
      <input name="message" defaultValue="hello" />
      <RecaptchaField action="contact" lazy={lazy} refreshIntervalMs={refreshIntervalMs} />
      <button type="submit">Send</button>
      <pre data-testid="result">{JSON.stringify(state)}</pre>
    </form>
  );
}
