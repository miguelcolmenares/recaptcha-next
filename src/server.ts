import { createVerifyRecaptcha } from "./application/verifyRecaptcha";
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

/** Verify a token with Google. Reads `RECAPTCHA_SECRET_KEY` unless `options.secret` is given. */
export const verifyRecaptcha = createVerifyRecaptcha({
  gateway: createGoogleVerifyGateway(),
  getSecret: () => process.env[ENV_SECRET_KEY],
  isProduction: requiresConfiguredSecret,
  warn: (message) => console.warn(message),
});

/** True when verification is required, including in unknown runtime environments. */
export function isRecaptchaEnabled(): boolean {
  return requiresConfiguredSecret() || Boolean(process.env[ENV_SECRET_KEY]);
}
