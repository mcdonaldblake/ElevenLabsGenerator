import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": new URL(".", import.meta.url).pathname },
  },
  test: {
    include: ["app/**/*.test.{ts,tsx}", "components/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
