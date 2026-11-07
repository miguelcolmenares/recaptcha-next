# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The default server requires a secret in production and in absent or unknown
  runtime modes. Only explicit development and test modes allow unconfigured checks.
  `isRecaptchaEnabled()` uses the same rule as the default verifier.
- Malformed scores return `invalid-score`, including at `minScore: 0`.
  The domain rule accepts only finite numeric scores from 0 through 1.
- Browser loading initializes each key independently. Matching layout tags wait
  for their own load event or require a completion marker set after successful loading.
  Unconfirmed layout loads reject after 15 seconds; failed tags allow retries.
  The README and navigation guide explain the layout marker requirement.

### Changed

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
