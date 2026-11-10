"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRecaptcha } from "recaptcha-next/client";
import { submitAction } from "../../actions";
import { initialState } from "../../initial-state";
import type { SubmitState } from "../../actions";

// No hidden input here. The token is requested when the user submits, put in a FormData built
// by hand, and sent to the Server Action. This is the path for custom FormData and fetch calls.
export default function ProgrammaticForm() {
  const { status, execute } = useRecaptcha({ action: "contact" });
  const [state, setState] = useState<SubmitState>(initialState);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("message", "hello");
    formData.set("g-recaptcha-response", await execute());
    setState(await submitAction(initialState, formData));
  }

  return (
    <form onSubmit={onSubmit}>
      <p data-testid="status">{status}</p>
      <button type="submit" disabled={status !== "ready"}>
        Send programmatically
      </button>
      <pre data-testid="result">{JSON.stringify(state)}</pre>
    </form>
  );
}
