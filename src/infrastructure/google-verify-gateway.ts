import type { VerifyGateway } from "@/application";
import { RECAPTCHA_VERIFY_URL } from "@/domain";
import type { RecaptchaVerifyResponse } from "@/domain";

export interface GoogleVerifyGatewayOptions {
  /** Override for tests. Defaults to the real Google endpoint. */
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createGoogleVerifyGateway(options: GoogleVerifyGatewayOptions = {}): VerifyGateway {
  const { url = RECAPTCHA_VERIFY_URL, fetchImpl = fetch, timeoutMs = 5_000 } = options;

  return {
    async verify({ secret, token, remoteIp }) {
      const body = new URLSearchParams({ secret, response: token });
      if (remoteIp) body.set("remoteip", remoteIp);

      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`reCAPTCHA verification request failed with status ${response.status}`);
      }
      return (await response.json()) as RecaptchaVerifyResponse;
    },
  };
}
