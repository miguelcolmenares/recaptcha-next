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

Tests that need a real answer from Google need a real key pair with `localhost` in its domains. This package keeps them out of fork and Dependabot pull requests, which have no secrets: the tests skip themselves when the keys are not set, and everything else still runs.
