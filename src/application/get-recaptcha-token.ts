import { RECAPTCHA_TOKEN_FIELD } from "@/domain";

/**
 * Read the token from submitted form data. Returns null when the field is missing or empty,
 * for example when the form was built with custom FormData that left out the hidden input.
 */
export function getRecaptchaToken(
  formData: FormData,
  field: string = RECAPTCHA_TOKEN_FIELD,
): string | null {
  const value = formData.get(field);
  return typeof value === "string" && value.length > 0 ? value : null;
}
