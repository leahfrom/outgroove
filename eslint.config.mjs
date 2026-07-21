import eslint from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".vite/**",
      "out/**",
      "coverage/**",
      "node_modules/**",
      "eslint.config.mjs",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}", "src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["electron", "node:*", "better-sqlite3"],
              message:
                "Privileged modules are forbidden in renderer/shared code.",
            },
            {
              group: ["**/main/**", "**/workers/**"],
              message:
                "Renderer/shared code cannot cross into privileged layers.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["*.config.{mjs,ts}", "forge.config.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
);
