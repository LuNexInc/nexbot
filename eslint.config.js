// Flat ESLint config. TypeScript strict already owns type errors; lint adds
// the async-correctness rules that matter most in a child-process + SSE
// server, plus the JS footgun baseline. Style is deliberately not policed —
// the codebase has its own formatting rhythm and churn is not worth it.
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const SOURCES = ["server/**/*.ts", "src/**/*.{ts,tsx}", "scripts/**/*.mjs", "vite.config.ts", "eslint.config.js"];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-server/**",
      "release/**",
      "coverage/**",
      "node_modules/**",
      "connect-android/**",
      "electron/updater.bundle.cjs",
      "outputs/**",
      "public/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: SOURCES })),
  {
    files: SOURCES,
    rules: {
      // The codebase uses `any` at protocol boundaries by design; strict TS
      // catches the mistakes that matter. Unused names are a warning.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // `let x = init; try { x = risky(); } catch { return; }` is a common
      // safe idiom here; the linter's last-write analysis adds noise, not signal.
      "no-useless-assignment": "warn",
    },
  },
  {
    // Type-aware: a dropped .catch() on a child process or SSE write is the
    // class of bug that takes the tray process down.
    files: ["server/**/*.ts"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.server.json", tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
);
