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
      moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
      testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts?(x)"],
      testPathIgnorePatterns: ["/__tests__/integration/"],
    },
    {
      roots: ["<rootDir>/src"],
      displayName: "integration",
      testEnvironment: "node",
      transform,
      moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
      testMatch: ["<rootDir>/src/**/__tests__/integration/**/*.test.ts?(x)"],
    },
  ],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/__tests__/**", "!src/**/index.ts"],
};
