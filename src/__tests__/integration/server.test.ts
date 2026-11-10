import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve(__dirname, "../../..");
const withBuild = existsSync(resolve(packageRoot, "dist/server.cjs")) ? describe : describe.skip;

withBuild("packaged server environment policy", () => {
  it.each([undefined, "", "staging", "production", "development", "test"])(
    "uses the default policy in a new Node process with NODE_ENV %p",
    (environment) => {
      const env = { ...process.env };
      delete env.RECAPTCHA_SECRET_KEY;
      if (environment === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = environment;

      const child = spawnSync(
        process.execPath,
        [
          "-e",
          `
        const server = require('recaptcha-next/server');
        server.verifyRecaptcha('token').then(result => {
          console.log(JSON.stringify({ required: server.isRecaptchaEnabled(), result }));
        }).catch(error => { console.error(error); process.exitCode = 1; });
      `,
        ],
        { cwd: packageRoot, env, encoding: "utf8" },
      );
      expect({ status: child.status, stderr: child.stderr, error: child.error }).toMatchObject({
        status: 0,
      });
      const output = JSON.parse(child.stdout) as {
        required: boolean;
        result: { success: boolean; reason: string };
      };
      if (environment === "development" || environment === "test") {
        expect(output.required).toBe(false);
        expect(output.result).toMatchObject({
          success: true,
          reason: "missing-secret-in-development",
        });
      } else {
        expect(child.stderr).toContain("[recaptcha-next] verification failed");
        expect(child.stderr).toContain("missing-secret");
        expect(child.stderr).not.toContain("token");
        expect(output).toEqual({
          required: true,
          result: { success: false, reason: "missing-secret" },
        });
      }
    },
  );
});
