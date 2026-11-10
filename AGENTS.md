# AGENTS.md

Context for any AI agent working in this repository.

## What this is

`recaptcha-next`: reCAPTCHA v3 for React and Next.js, MIT. Written from scratch.
Do not add code, text or configuration copied from other projects, and do not add dependencies on private packages.

## Layout (Domain-Driven Design, barrel exports)

```text
src/
  domain/          pure rules, constants, types. No I/O, no React.
  application/     use cases and ports (interfaces). Depends on domain only.
  infrastructure/  adapters: Google HTTP gateway, browser script loader. Implements ports.
  presentation/    token renewal controller and React hooks.
    recaptcha-field/index.tsx  field render, props and hook wiring only.
  index.ts         root entry: values and types, no React
  client.ts        "use client" entry
  server.ts        server entry, where adapters are wired to use cases
  __tests__/       composition-root tests, including integration/server.test.ts.
e2e/
  fixture/app/     Next.js app used to consume the packed tarball
  specs/           Playwright specs
scripts/           verify-package.mjs, the pack-and-install check
```

Rules: dependencies point inward (presentation and infrastructure may import application and domain, never the
reverse). Presentation also uses the browser adapter from infrastructure. Every layer has an `index.ts` that only
re-exports. Code outside a layer, including the package entry points, imports its barrel, never its internal files.
The package build removes unused exports from the infrastructure barrel; `verify:package` checks that the server
gateway stays out of the browser bundle.

Each layer owns a `__tests__/` folder. Integration suites live in that owner's `__tests__/integration/` folder.
The root `src/__tests__/` tests the package composition roots; other tests live with their layer or component.

## Naming

- Files and folders use kebab-case, for example `use-recaptcha.ts`, `script-loader.ts` and `token-renewal.test.ts`.
- Each component has its own folder with an `index.tsx` containing only the component and its props interface.
- Components use default exports. Barrels re-export them by their public names; other exports are named.
- Each file owns one responsibility. Keep token scheduling in `token-renewal.ts`, React state and input synchronization
  in `use-token-renewal.ts`, observation in `use-lazy-visibility.ts` and form listeners in `use-form-token-events.ts`.
- Tests: `<owner>/__tests__/<module>.test.ts(x)`, one suite per module. Specs: `e2e/specs/<feature>.spec.ts`.
- Source imports use `@/` for `src/`; relative imports are fine within the same folder. Cross-layer imports use barrels.
- Types are exported with `export type`. Use `import type` for type-only imports.
- Documentation comments use TSDoc syntax. Declare mocks before imports, and call every hook before a conditional return.

## Tests

Three levels, all required for new behavior:

1. **Unit** (`npm run test:unit`): no network. Test modules independently and retain field wiring regressions.
   jsdom only where the DOM is needed (`@jest-environment jsdom`); `token-renewal` uses fake timers without a DOM.
2. **Integration** (`npm run test:integration`): real use case and real adapter over a local HTTP server.
3. **End-to-end** (`npm run test:e2e`): packs the tarball, installs it in `e2e/fixture`, builds it with Next.js,
   checks the build output, then runs Playwright.

Tests transpile only (`@swc/jest`). Types are checked by `npm run typecheck`, never inside the test runner.
Tests that need a real Google key skip themselves when the keys are missing.

## Rules learned the hard way

- `process.env.NEXT_PUBLIC_*` must be a literal member expression in client code, or the bundler will not inline it.
  `verify:package` fails if it is not.
- Server code must never reach the browser bundle. `verify:package` greps the bundle.
- `peerDependencies` list only majors that the tests run. Narrow first, widen with evidence.
- Every subpath must resolve under `node10`, `node16` and `bundler`. `verify:package` checks all three.
- A dev tool must not cap TypeScript in its peer range. One exception is documented in `.github/dependabot.yml`.
- A callback prop must never restart an effect. Keep callbacks in refs. A numeric prop that only sets a delay (`refreshIntervalMs`) is read from a ref too. Consumer callbacks run last, after the field's own state and timers are updated, and only through `callSafely`, which logs a static message and the known prop name, never the thrown value, stack or callback argument, and never rethrows.
- Loading a script is not the same as initializing the API. Wait for `grecaptcha.ready`. A failed initialization removes its unusable tag so retry can load a fresh script; a wrapper deadline alone keeps the pending tag for late recovery.
- Never unload Google's script when a component unmounts. Tested with real Google: removing the tag and
  loading it again after a client-side navigation left duplicate badges and extra scripts, and sometimes a
  `window.grecaptcha` with no tag. A stubbed script hides this, so the navigation specs run against real Google too.
- Errors that Google's own frames log in the console (for example `requestStorageAccess`) are not ours. The e2e
  helper filters them by origin and by one exact message, nothing broader.
- Release with npm trusted publishing (OIDC). No long-lived tokens.
- Node support: CI runs every Node line that is not past end of life (today 22, 24 and 26), and the e2e and publish
  jobs run on the newest LTS. Node 22 ends on 2027-04-30: drop it from the matrix and from `engines` then. Node 26 became
  LTS on 2026-10-28 and ends on 2029-04-30. Trusted publishing needs npm 11.5.1 or newer, which every Node here ships.

## Tokens and refusals

- A reCAPTCHA token is single use. Google spends it on the first check.
- `RecaptchaField` renews the token on the `formdata` event, which fires when a submit builds the form's data (a canceled submit does not). `new FormData(form)` fires it too, so it spends the token: read the form once, at submit time. A renewal is asked for only when the input held a token and no request is in flight, and `formdata` from any other form (including a nested one) is ignored. Build `new FormData(form)` when a form element exists, then normalize that payload. Do not copy its hidden token manually or remount the field after server answers. A payload without a form element can use `useRecaptcha().execute()` before each attempt.
- The default `verifyRecaptcha` owns refusal logging: `reason`, `score` and `errorCodes`, with no token, secret or form fields. Consume its typed result without adding duplicate failure logs. Custom verifiers built with `createVerifyRecaptcha` leave observation to their caller.
- Retries belong to script loading and field token generation. The default server checks Google once, with a five-second deadline, and never replays a lead or other business submission. `useRecaptcha().execute()` is lower level: it has no field-owned generation deadline, retry, expiry or form-read renewal.
- Always call `verifyRecaptcha` in a Server Action; `isRecaptchaEnabled()` is configuration diagnostics, not a verification bypass. Missing tokens are rejected before secret handling.
- Never log the token, and never log the secret key.

## Commits

Plain messages in the imperative. No attribution trailers.
