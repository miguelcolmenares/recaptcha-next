<!-- agents-toolkit:planning-doc issue=15 -->

# Architecture rules for issue #15

## Problem and current architecture

The package uses domain, application, infrastructure and presentation layers, each with a barrel.
`RecaptchaField` currently owns visibility, token renewal, form listeners and rendering.
Tests live in a flat `src/__tests__/` directory, and module names use mixed casing.
PR #14 and the subsequent lifecycle fixes in PR #16 are merged into `main`.

## Proposed changes

Preserve runtime behavior, public symbols, package subpaths and dependency versions.
Use `git mv` for kebab-case renames and colocate tests with their owning layer or component.
Import other layers through their barrels with the `@/` alias.
Configure the alias in TypeScript, tsdown and Jest, and verify that published declarations resolve without it.

Keep the component in `presentation/recaptcha-field/index.tsx`, with its props and wiring only.
Extract token scheduling, expiry, retries, cancellation and spent-token queuing into a plain `token-renewal` module.
Use a small React adapter to synchronize token state and the input before consumer callbacks run.
Extract visibility into `use-lazy-visibility` and enclosing-form listeners into `use-form-token-events`.
Keep callback isolation and the literal public environment lookup in their own modules.

## Phases

- [ ] Phase 1: Rename modules and tests, colocate suites, configure aliases and update barrels.
- [ ] Phase 2: Extract the renewal controller and hooks, split regression tests and add isolated module tests.
- [ ] Phase 3: Update repository instructions, README, testing documentation and changelog.
- [ ] Phase 4: Run acceptance checks, then perform a read-only `core-review --budget thorough` and resolve findings.

## Testing strategy

Retain existing regression coverage for form reads, expiry, retries, callback failures, key changes and lazy activation.
Test the renewal controller with fake timers in the Node environment, without React or a DOM.
Test each hook independently with React Testing Library, with mocks declared before imports.
Run `lint`, `format:check`, `typecheck`, `npm test`, `build` and `test:e2e`.
The package check must validate ESM, CommonJS, all supported type-resolution modes and browser/server separation.
Tests requiring real Google credentials skip themselves when credentials are unavailable.
The final review covers tracked source, tests, scripts, workflows, documentation and the documentation site.
