/** @type {import('jest').Config} */
const transform = {
  "^.+\\.(t|j)sx?$": [
    "@swc/jest",
    {
      jsc: {
        parser: { syntax: "typescript", tsx: true },
        transform: { react: { runtime: "automatic" } },
        target: "es2022",
      },
      module: { type: "commonjs" },
    },
  ],
};

module.exports = {
  projects: [
    {
      roots: ["<rootDir>/src"],
      displayName: "unit",
      testEnvironment: "node",
      transform,
      testMatch: ["<rootDir>/src/__tests__/*.test.ts", "<rootDir>/src/__tests__/*.test.tsx"],
    },
    {
      roots: ["<rootDir>/src"],
      displayName: "integration",
      testEnvironment: "node",
      transform,
      testMatch: [
        "<rootDir>/src/__tests__/integration/*.test.ts",
        "<rootDir>/src/__tests__/integration/*.test.tsx",
      ],
    },
  ],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/__tests__/**", "!src/**/index.ts"],
};
