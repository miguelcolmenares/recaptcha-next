"use client";

import { RecaptchaField } from "recaptcha-next/client";

export default function CallbackErrorPage() {
  return (
    <form>
      <RecaptchaField
        action="contact"
        onTokenGenerated={(token) => {
          throw new Error(`private callback detail: ${token}`);
        }}
      />
    </form>
  );
}
