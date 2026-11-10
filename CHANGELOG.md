# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A script that loads without a usable reCAPTCHA API is removed before retrying, including a layout tag marked as loaded. Previously each retry reused the broken tag and could never recover. Pending scripts and readiness callbacks that only time out are still retained for late recovery.

- Disabling lazy loading before an offscreen field becomes visible now starts loading; re-enabling lazy mode keeps that load and token lifecycle active.

- The default server verifier logs failed checks with `reason`, `score` and `errorCodes`, without
  logging the token, secret or submitted form fields.
- A replacement consumed before an earlier form-read task runs is renewed immediately. An unspent
  replacement is kept, avoiding an unnecessary Google request.
- Refresh delays are capped at 110 seconds, starting renewal at least 10 seconds before token
  expiry. A slow or failed renewal can still leave the field empty. Changing the action or site key, or unmounting, also clears that pending deadline.
- `RecaptchaField` asks for a new token when the browser builds the form's data for a submit,
  so a visitor refused by the server can send the form again. A canceled submit renews nothing.
  A token works once. The field keeps its timer, and a field outside a form renews on the timer
  only. A failed token request is retried after 5 seconds, then after longer waits up to 30
  seconds, and a token is cleared when its two minutes pass. The server docs cover the refusal reasons.
- `RecaptchaField` writes a new token to the hidden input before it calls `onTokenGenerated`.
  Before, the input still held the previous token (or nothing, for the first one) during the
  callback, so a `requestSubmit()` or `new FormData(form)` inside it sent an empty or stale token.
- `RecaptchaField` updates its own state and timers before it calls `onTokenGenerated` or
  `onError`, and calls each one through a helper that logs a throw with `console.error` and never
  rethrows. Before, a callback that threw skipped the expiry timer, the failure count and the next
  renewal, rejected without a handler, and an `onError` that threw in an effect reached the error
  boundary.
- `RecaptchaField` asks for a new token on `formdata` only when a token was spent, that is when the
  input held one and no request is in flight. Before, every read asked for one, even of an empty
  field, which skipped the retry delay and cost one request per read. A token that arrives between
  the read and the renewal is kept without another request. Two reads in one task send the token
  once, and the second read is empty.
- `RecaptchaField` ignores `formdata` events from other forms. The event bubbles, so a form nested
  in the field's form used to spend its token.
- `RecaptchaField` clears its token and the hidden input when `action` or `siteKey` changes. Before,
  going from A to B and back to A showed A's old token again, with no expiry timer.
- `useRecaptcha` and `RecaptchaField` load the script again after a failure, after 5, 10, 20 and
  then 30 seconds, until it works, the key changes or the component unmounts. Before, the field
  stayed in `error` until a remount. A new key starts at 5 seconds, and each failed attempt is
  reported once to `onError`. The load state also starts clean for each load, so A to B to A no
  longer reads A's old error and reports it again.
- `RecaptchaField` with `lazy` keeps loading lazily when the site key arrives after mount. Before,
  the missing key made the field show itself at once.
- Changing only `refreshIntervalMs` no longer restarts the token effect. Before, it asked for an
  unrequested token and left it without an expiry timer. The new interval applies from the next
  refresh.
- The default server requires a secret in production and in absent or unknown
  runtime modes. Only explicit development and test modes allow unconfigured checks.
  `isRecaptchaEnabled()` uses the same rule as the default verifier.
- Malformed scores return `invalid-score`, including at `minScore: 0`.
  The domain rule accepts only finite numeric scores from 0 through 1.
- Browser loading initializes each key independently. Matching layout tags wait
  for their own load event or require a completion marker set after successful loading.
  Every load, including a fresh tag and its readiness callback, rejects after 15 seconds;
  retries reuse late successful loads without adding duplicate tags.
  The README and navigation guide explain the layout marker requirement.

### Changed

- Integration examples use a typed `useActionState` form and direct verification. The documentation distinguishes automatic script/token retries from business submissions, which the package never replays.

- The documentation site is upgraded to docs-sitekit 0.2.4, and a shared link to it now shows a picture: `site.image` names `/social.png`, a 1200 by 630 card that the docs workflow draws with [social-card-action](https://github.com/miguelcolmenares/social-card-action), so the pages have `og:image`, `twitter:image` and a large Twitter card.
- The documentation site is upgraded to docs-sitekit 0.2.3. The footer no longer shows the copyright sign and the year, "Built with docs-sitekit" links to the kit's site, the search button is named "Search" for screen readers, and the side areas of the doc pages are no longer unnamed landmarks.

### Security

- **`minimatch` is 11.0.5 in the development dependencies.** Versions 7.0.0 to 11.0.0 allow a denial of service through glob parts amplification (GHSA-g3hv-75wg-m249, patched in 11.0.1). An `overrides` entry in `package.json` moves the 10.x and 9.x copies that `eslint`, `glob` and the test tooling pull in to 11.0.5. It is a development dependency only, so the shipped package does not change.

## [0.1.0] - 2026-10-28

### Added

- `RecaptchaField` and `useRecaptcha` (`/client`): hidden-input token field with refresh, lazy loading, and stable handling of callback props.
- `verifyRecaptcha`, `getRecaptchaToken`, `isRecaptchaEnabled` (`/server`): server-side check of score, action and hostname that returns a typed result.
- A documentation site built with [docs-sitekit](https://github.com/miguelcolmenares/docs-sitekit): getting started, guides, API reference and examples, published to GitHub Pages by `publish.yml` after each release and by `docs.yml` on changes to `main`.
- Root entry with constants, types and the pure `evaluateResponse` rule, free of React.
- Pack-and-install verification (`npm run verify:package`): checks the tarball, runs the installed package in plain Node as ESM and CommonJS, builds a Next.js app with it and resolves types under `node10`, `node16` and `bundler`.
- Playwright end-to-end tests, including client-side navigation, back and forward, and lazy loading, against a stubbed script and against real Google.
