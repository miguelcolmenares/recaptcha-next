import { createVerifyRecaptcha } from "@/application";
import type { VerifyRecaptcha } from "@/application";
import { ENV_SECRET_KEY } from "@/domain";
import { createGoogleVerifyGateway } from "@/infrastructure";

export { getRecaptchaToken } from "@/application";
export type { VerifyGateway, VerifyRecaptcha } from "@/application";
export { createVerifyRecaptcha } from "@/application";
export { createGoogleVerifyGateway } from "@/infrastructure";
export type {
  RecaptchaVerifyResponse,
  VerificationFailureReason,
  VerificationSkipReason,
  VerificationResult,
  VerificationRules,
  VerifyOptions,
} from "@/domain";

/** Unknown runtime modes enforce the same secret requirement as production. */
function requiresConfiguredSecret(): boolean {
  switch (process.env.NODE_ENV) {
    case "development":
    case "test":
      return false;
    default:
      return true;
  }
}

const verify = createVerifyRecaptcha({
  gateway: createGoogleVerifyGateway(),
  getSecret: () => process.env[ENV_SECRET_KEY],
  isProduction: requiresConfiguredSecret,
  warn: (message) => console.warn(message),
});

/** Verify with the configured gateway and log failed checks without credentials or tokens. */
export const verifyRecaptcha: VerifyRecaptcha = async (token, options) => {
  const result = await verify(token, options);
  if (!result.success) {
    console.error("[recaptcha-next] verification failed", {
      reason: result.reason,
      score: result.score,
      errorCodes: result.errorCodes,
    });
  }
  return result;
};

/** Reports strict-secret or configured-secret policy; always verify the submitted token. */
export function isRecaptchaEnabled(): boolean {
  return requiresConfiguredSecret() || Boolean(process.env[ENV_SECRET_KEY]);
}
