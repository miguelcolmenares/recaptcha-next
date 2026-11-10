import { createVerifyRecaptcha } from "./application/verifyRecaptcha";
import type { VerifyRecaptcha } from "./application/verifyRecaptcha";
import { ENV_SECRET_KEY } from "./domain/constants";
import { createGoogleVerifyGateway } from "./infrastructure/googleVerifyGateway";

export { getRecaptchaToken } from "./application/getRecaptchaToken";
export type { VerifyGateway, VerifyRecaptcha } from "./application/verifyRecaptcha";
export { createVerifyRecaptcha } from "./application/verifyRecaptcha";
export { createGoogleVerifyGateway } from "./infrastructure/googleVerifyGateway";
export type * from "./domain/types";

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

/** True when verification is required, including in unknown runtime environments. */
export function isRecaptchaEnabled(): boolean {
  return requiresConfiguredSecret() || Boolean(process.env[ENV_SECRET_KEY]);
}
