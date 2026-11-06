/** Raw body returned by the Google siteverify endpoint. */
export interface RecaptchaVerifyResponse {
  success: boolean;
  score?: number;
  action?: string;
  hostname?: string;
  challenge_ts?: string;
  "error-codes"?: string[];
}

export type VerificationFailureReason =
  | "missing-secret"
  | "missing-token"
  | "request-failed"
  | "rejected-by-google"
  | "invalid-score"
  | "low-score"
  | "action-mismatch"
  | "hostname-mismatch";

/** Why a verification passed without calling Google. */
export type VerificationSkipReason = "missing-secret-in-development";

export type VerificationResult =
  | { success: true; skipped: false; score: number; action: string; hostname: string }
  | { success: true; skipped: true; reason: VerificationSkipReason }
  | {
      success: false;
      reason: VerificationFailureReason;
      score?: number;
      errorCodes?: string[];
    };

export interface VerificationRules {
  /** Minimum accepted score, from 0 to 1. Defaults to `DEFAULT_MIN_SCORE`. */
  minScore?: number;
  /** The action name the client used. A token made for another action is rejected. */
  expectedAction?: string;
  /** The hostname the token must come from. Skipped when not set. */
  expectedHostname?: string;
}

export interface VerifyOptions extends VerificationRules {
  /** Overrides the `RECAPTCHA_SECRET_KEY` environment variable. */
  secret?: string;
  /** Client IP, sent to Google as an extra signal. */
  remoteIp?: string;
}
