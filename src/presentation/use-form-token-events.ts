import { useEffect, useRef } from "react";
import type { RefObject } from "react";

interface UseFormTokenEventsOptions {
  anchorRef: RefObject<HTMLElement | null>;
  siteKey?: string;
  onActivate?: () => void;
  onTokenSpent: () => void;
}

/** Subscribes only to the enclosing form. A canceled submit spends no token. */
export function useFormTokenEvents({
  anchorRef,
  siteKey,
  onActivate,
  onTokenSpent,
}: UseFormTokenEventsOptions) {
  const latest = useRef({ onActivate, onTokenSpent });
  const activateOnSubmit = Boolean(onActivate);
  useEffect(() => {
    latest.current = { onActivate, onTokenSpent };
  });

  useEffect(() => {
    if (!siteKey) return;
    const form = anchorRef.current?.closest("form");
    if (!form) return;
    const onSubmit = () => latest.current.onActivate?.();
    const onFormData = (event: Event) => {
      latest.current.onActivate?.();
      // formdata bubbles. A nested form must not spend the enclosing form's token.
      if (event.target === form) latest.current.onTokenSpent();
    };
    if (activateOnSubmit) form.addEventListener("submit", onSubmit);
    form.addEventListener("formdata", onFormData);
    return () => {
      if (activateOnSubmit) form.removeEventListener("submit", onSubmit);
      form.removeEventListener("formdata", onFormData);
    };
  }, [anchorRef, siteKey, activateOnSubmit]);
}
