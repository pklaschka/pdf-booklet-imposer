import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  // Unit tests only; the browser tests in e2e/ belong to Playwright.
  test: { include: ["src/**/*.test.ts"] },
  // Relative base so the app can be hosted under any sub-path.
  base: "./",
  build: { target: "es2022" },
});
