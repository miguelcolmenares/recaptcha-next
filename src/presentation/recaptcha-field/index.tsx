import { useRef } from "react";
import { RECAPTCHA_TOKEN_FIELD, TOKEN_REFRESH_MARGIN_MS, TOKEN_TTL_MS } from "@/domain";
import { readSiteKey } from "@/presentation/read-site-key";
import { useFormTokenEvents } from "@/presentation/use-form-token-events";
import { useLazyVisibility } from "@/presentation/use-lazy-visibility";
import { useRecaptcha } from "@/presentation/use-recaptcha";
import { useTokenRenewal } from "@/presentation/use-token-renewal";

export interface RecaptchaFieldProps {
  /** Action name, checked again on the server. */
  action: string;
  /** Defaults to `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`. */
  siteKey?: string;
  /** Name of the hidden input. Defaults to `g-recaptcha-response`. */
  name?: string;
  /**
   * Wait until the form is near the viewport before loading the script. A submit before that
   * loads the script too, but its own data goes out without a token, so only the next one has one.
   */
  lazy?: boolean;
  /** How early lazy loading starts, as a CSS margin. Defaults to `200px`. */
  lazyRootMargin?: string;
  /** Milliseconds between refreshes, capped at 110 seconds. Defaults to 90 seconds. Changes apply to the next refresh. */
  refreshIntervalMs?: number;
  /**
   * Called on every new token, once the token is already in the hidden input, so reading or
   * submitting the form inside it sends this token. Unstable function props are safe, no
   * `useCallback` needed. Callback failures log the prop name only, without error contents,
   * and are otherwise ignored.
   */
  onTokenGenerated?: (token: string) => void;
  /**
   * Called each time loading the script, making a token or a renewal fails. Failed loads and
   * renewals are retried, with a growing delay, so this can fire more than once in a row, once per
   * failed attempt. Callback failures log the prop name only, without error contents, and are
   * otherwise ignored.
   */
  onError?: (error: Error) => void;
}

/**
 * Renders a hidden input that holds a token for the current action and site key. It is empty
 * until the first token arrives, again after a change until the new token arrives, and after a
 * form submit until the renewal for that submit arrives (or stays empty if the renewal fails).
 * A token also goes empty when its two minutes pass, and a failed renewal is retried. A change of
 * action or site key ends the token, so going from one pair to another and back never shows the
 * old one. Renders nothing without a site key.
 *
 * The token is spent when the form's data is read. The field clears it and asks for a new one on
 * the `formdata` event, which fires when the browser builds the form data for a submit. A submit
 * that is canceled (for example by validation) builds no form data, so it renews nothing. It asks
 * only when a token was spent: a read of an empty field, or while a request is in flight, asks
 * for nothing, and a `formdata` event from a nested form is ignored.
 *
 * Reading the form with `new FormData(form)` also fires `formdata`, so it renews the token too,
 * and the FormData you just built still carries the token it read. Read the form once, at submit
 * time, and send that same FormData.
 */
export default function RecaptchaField({
  action,
  siteKey: siteKeyProp,
  name = RECAPTCHA_TOKEN_FIELD,
  lazy = false,
  lazyRootMargin = "200px",
  refreshIntervalMs = TOKEN_TTL_MS - TOKEN_REFRESH_MARGIN_MS,
  onTokenGenerated,
  onError,
}: RecaptchaFieldProps) {
  const siteKey = siteKeyProp ?? readSiteKey();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { visible, activate } = useLazyVisibility({
    anchorRef,
    siteKey,
    lazy,
    rootMargin: lazyRootMargin,
  });
  const recaptcha = useRecaptcha({ action, siteKey, enabled: visible });
  const { token, spendToken } = useTokenRenewal({
    ...recaptcha,
    action,
    siteKey,
    inputRef,
    refreshIntervalMs,
    onTokenGenerated,
    onError,
  });
  useFormTokenEvents({
    anchorRef,
    siteKey,
    onActivate: lazy && !visible ? activate : undefined,
    onTokenSpent: spendToken,
  });

  if (!siteKey) return null;

  return (
    <span ref={anchorRef} data-recaptcha-field="">
      <input ref={inputRef} type="hidden" name={name} value={token} readOnly />
    </span>
  );
}
