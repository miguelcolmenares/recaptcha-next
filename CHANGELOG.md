# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The documentation site is upgraded to docs-sitekit 0.2.4, and a shared link to it now shows a picture: `site.image` names `site/public/social.png`, a 1200 by 630 card drawn with [social-card-action](https://github.com/miguelcolmenares/social-card-action), so the pages have `og:image`, `twitter:image` and a large Twitter card.
- The documentation site is upgraded to docs-sitekit 0.2.3. The footer no longer shows the copyright sign and the year, "Built with docs-sitekit" links to the kit's site, the search button is named "Search" for screen readers, and the side areas of the doc pages are no longer unnamed landmarks.

## [0.1.0] - 2026-10-28

### Added

- `RecaptchaField` and `useRecaptcha` (`/client`): hidden-input token field with refresh, lazy loading, and stable handling of callback props.
- `verifyRecaptcha`, `getRecaptchaToken`, `isRecaptchaEnabled` (`/server`): server-side check of score, action and hostname that returns a typed result.
- A documentation site built with [docs-sitekit](https://github.com/miguelcolmenares/docs-sitekit): getting started, guides, API reference and examples, published to GitHub Pages by `publish.yml` after each release and by `docs.yml` on changes to `main`.
- Root entry with constants, types and the pure `evaluateResponse` rule, free of React.
- Pack-and-install verification (`npm run verify:package`): checks the tarball, runs the installed package in plain Node as ESM and CommonJS, builds a Next.js app with it and resolves types under `node10`, `node16` and `bundler`.
- Playwright end-to-end tests, including client-side navigation, back and forward, and lazy loading, against a stubbed script and against real Google.
