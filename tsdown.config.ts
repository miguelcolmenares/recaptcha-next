import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
    server: "src/server.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  platform: "neutral",
  alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  deps: { neverBundle: ["react", "react/jsx-runtime"] },
  // Keep the file names the "exports" map declares: .js for ESM, .cjs for CJS.
  fixedExtension: false,
});
