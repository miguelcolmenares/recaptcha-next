---
order: 6
---

# Testing

Your own tests should not call Google. The server side is built from small parts that you can replace.

## Build a verifier with your own gateway

`createVerifyRecaptcha` takes the pieces `verifyRecaptcha` uses and returns a function with the same verification decisions, so you can decide what Google "answers".
The factory leaves logging to its caller; the default server verifier owns its own safe failure log.

```ts
import { createVerifyRecaptcha } from "recaptcha-next/server";

const verify = createVerifyRecaptcha({
  gateway: {
    verify: async () => ({ success: true, score: 0.2, action: "contact", hostname: "localhost" }),
  },
  getSecret: () => "test-secret",
  isProduction: () => true,
  warn() {},
});

const result = await verify("any-token");
// { success: false, reason: "low-score", score: 0.2 }
```

This covers every reason a result can have, with no network and no keys.

## The pure rule

`evaluateResponse` is the rule that turns Google's answer into a result. It has no network, no React and no browser code, and is exported from the root entry, so it is safe to import anywhere.

```ts
import { evaluateResponse } from "recaptcha-next";

evaluateResponse({ success: true, score: 0.9, action: "contact", hostname: "localhost" });
```

## End to end

Tests that need a real answer from Google need a real key pair with `localhost` in its domains.
Fork and Dependabot pull requests have no secrets, so those tests skip themselves when the keys are not set.
Everything else still runs.

## Contributing to the package

Tests live in a `__tests__/` folder inside the layer or component that owns the module.
Each file uses its module's kebab-case name, such as `token-renewal.test.ts`.
The package entry points have their tests in `src/__tests__/`.
Integration suites live in the owning layer's `__tests__/integration/`, or the root equivalent for entry points.

The field's responsibilities are tested separately:

| Module                                   | Coverage                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `presentation/recaptcha-field/index.tsx` | Rendering, input names and wiring                                                              |
| `presentation/token-renewal.ts`          | Scheduling, retries, expiry, cancellation and spent-token queuing, with fake timers and no DOM |
| `presentation/with-timeout.ts`           | Request deadlines and cancellation                                                             |
| `presentation/use-token-renewal.ts`      | React state, input synchronization, current callbacks and action/key changes                   |
| `presentation/use-lazy-visibility.ts`    | Observation, eager fallback, activation and lazy-mode changes                                  |
| `presentation/use-form-token-events.ts`  | Form reads, submit paths, event scoping and listener cleanup                                   |
| `presentation/use-recaptcha.ts`          | Script loading, retries and action/key changes                                                 |
| `presentation/call-safely.ts`            | Callback isolation and private failure logs                                                    |
| `presentation/read-site-key.ts`          | Public environment lookup                                                                      |

Paths in this table are relative to `src/`. The React suites also retain field-level regressions
for the interactions between these modules. Tests transpile with SWC; TypeScript checks types separately.
Jest, TypeScript and tsdown resolve the same `@/` alias for `src/`.

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run test:unit` and `npm run test:integration` select the corresponding Jest project.
The package e2e command installs the packed tarball in `e2e/fixture/.build` and builds the Next.js consumer.
It checks ESM, CommonJS, type resolution and browser/server separation before running Playwright.
