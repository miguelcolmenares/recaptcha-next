---
order: 8
---

# Server API

Everything in `recaptcha-next/server`, plus the pure rule exported by the root entry. None of it ships to the browser.

## `verifyRecaptcha(token, options?)`

Checks a token with Google and returns a result. It does not throw.

| Option             | Default                | Description                                    |
| ------------------ | ---------------------- | ---------------------------------------------- |
| `minScore`         | `0.5`                  | Scores below this are refused.                 |
| `expectedAction`   |                        | The action the token must have been made for   |
| `expectedHostname` |                        | The hostname the token must have been made for |
| `secret`           | `RECAPTCHA_SECRET_KEY` | The secret key, if you do not use the env var  |
| `remoteIp`         |                        | The visitor's IP, passed on to Google          |

## The result

| Outcome           | Fields                                                                      |
| ----------------- | --------------------------------------------------------------------------- |
| Verified          | `success: true`, `skipped: false`, `score`, `action`, `hostname`            |
| Skipped by policy | `success: true`, `skipped: true`, `reason: "missing-secret-in-development"` |
| Rejected          | `success: false`, `reason`, optional `score` and `errorCodes`               |

Failure reasons:

| Reason               | Meaning                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `missing-secret`     | The runtime requires verification but has no configured secret.      |
| `missing-token`      | The form data had no token.                                          |
| `request-failed`     | The request to Google failed.                                        |
| `rejected-by-google` | Google said the token is not valid. `errorCodes` has the details.    |
| `invalid-score`      | The score is absent, non-numeric, non-finite or outside 0 through 1. |
| `action-mismatch`    | The token was made for a different action than `expectedAction`.     |
| `hostname-mismatch`  | The token was made for a different hostname than `expectedHostname`. |
| `low-score`          | The score is below `minScore`.                                       |

## Other functions

- `getRecaptchaToken(formData, field?)` returns the token or `null`, also when the field is empty.
- `isRecaptchaEnabled()` returns `true` when verification is required. It returns
  `false` only in explicit development or test mode without a secret.
- `createVerifyRecaptcha(deps)` and `createGoogleVerifyGateway(options)` build a custom verifier. See [Testing](testing.md).

The default server accepts missing-secret bypass only for `NODE_ENV` values
`"development"` and `"test"`. Unknown or absent values require a configured secret.
For custom verifiers, the injected `isProduction` policy decides whether a secret
is required; `true` enforces it and `false` allows a warning and skip.

## Root entry

`recaptcha-next` exports the constants, the result types and the pure `evaluateResponse` rule. It has no React and no browser code, so it is safe in Server Components.

The default `verifyRecaptcha` logs failed checks as `[recaptcha-next] verification failed` with
`reason`, `score` and `errorCodes`. It excludes tokens, secrets and form fields.
The `createVerifyRecaptcha` factory returns typed results and leaves logging to its caller.
