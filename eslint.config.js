import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "artifacts/**", ".turbo/**", "**/.turbo/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        window: "readonly",
        document: "readonly",
        performance: "readonly",
        requestAnimationFrame: "readonly",
        setTimeout: "readonly",
      },
    },
  },
);
