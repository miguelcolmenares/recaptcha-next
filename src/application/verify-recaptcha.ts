import { evaluateResponse } from "@/domain";
import type { RecaptchaVerifyResponse, VerificationResult, VerifyOptions } from "@/domain";

/** Port: how the use case talks to Google. The real adapter lives in infrastructure. */
export interface VerifyGateway {
  verify(input: {
    secret: string;
    token: string;
    remoteIp?: string;
  }): Promise<RecaptchaVerifyResponse>;
}

export interface VerifierDependencies {
  gateway: VerifyGateway;
  /** Reads the default secret. Called on every verification, never cached. */
  getSecret: () => string | undefined;
  /** Enforce a configured secret. The default server also treats unknown modes as production. */
  isProduction: () => boolean;
  warn: (message: string) => void;
}

export type VerifyRecaptcha = (
  token: string | null | undefined,
  options?: VerifyOptions,
) => Promise<VerificationResult>;

export function createVerifyRecaptcha(deps: VerifierDependencies): VerifyRecaptcha {
  return async (token, options = {}) => {
    if (!token) return { success: false, reason: "missing-token" };

    const secret = options.secret ?? deps.getSecret();
    if (!secret) {
      if (deps.isProduction()) return { success: false, reason: "missing-secret" };
      deps.warn(
        "[recaptcha] No secret key configured, so verification was SKIPPED. " +
          "The runtime policy explicitly permits unconfigured verification.",
      );
      return { success: true, skipped: true, reason: "missing-secret-in-development" };
    }

    try {
      const response = await deps.gateway.verify({ secret, token, remoteIp: options.remoteIp });
      return evaluateResponse(response, options);
    } catch {
      return { success: false, reason: "request-failed" };
    }
  };
}
