import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { callSafely } from "./call-safely";
import { createTokenRenewal } from "./token-renewal";
import type { UseRecaptchaResult } from "./use-recaptcha";

interface UseTokenRenewalOptions extends UseRecaptchaResult {
  action: string;
  siteKey?: string;
  inputRef: RefObject<HTMLInputElement | null>;
  refreshIntervalMs: number;
  onTokenGenerated?: (token: string) => void;
  onError?: (error: Error) => void;
}

/** Adapts the renewal controller to React state and a controlled hidden input. */
export function useTokenRenewal({
  action,
  siteKey,
  inputRef,
  status,
  error,
  execute,
  refreshIntervalMs,
  onTokenGenerated,
  onError,
}: UseTokenRenewalOptions) {
  const tokenKey = `${siteKey}\n${action}`;
  const [issued, setIssued] = useState<{ key: string; value: string } | null>(null);
  const controller = useRef<ReturnType<typeof createTokenRenewal> | null>(null);
  const latest = useRef({ refreshIntervalMs, onTokenGenerated, onError });
  useEffect(() => {
    latest.current = { refreshIntervalMs, onTokenGenerated, onError };
  });

  useEffect(() => {
    if (error) callSafely(latest.current.onError, error, "onError");
  }, [error]);

  useEffect(() => {
    if (status !== "ready") return;
    const input = inputRef.current;
    const current = createTokenRenewal({
      execute,
      getRefreshInterval: () => latest.current.refreshIntervalMs,
      onChange: (value) => {
        // A callback can submit before React renders. The input must already hold this value.
        if (input) input.value = value;
        setIssued(value === "" ? null : { key: tokenKey, value });
      },
      onTokenGenerated: (value) => latest.current.onTokenGenerated?.(value),
      onError: (cause) => latest.current.onError?.(cause),
    });
    controller.current = current;
    current.start();
    return () => {
      current.stop();
      controller.current = null;
    };
  }, [status, execute, tokenKey, inputRef]);

  const spendToken = useCallback(() => controller.current?.spendToken(), []);
  return { token: issued?.key === tokenKey ? issued.value : "", spendToken };
}
