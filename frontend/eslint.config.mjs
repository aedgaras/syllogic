import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import architecture from "./eslint-plugins/architecture-boundaries.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { architecture },
    rules: {
      "architecture/boundaries": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
    },
  },
  {
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["features/*/domain/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["window", "document", "navigator", "localStorage", "sessionStorage", "EventSource", "FileReader"].map(
          (name) => ({ name, message: "Domain modules cannot use browser APIs." })
        ),
      ],
    },
  },
  {
    files: [
      "lib/actions/dashboard.ts",
      "components/charts/*.tsx",
      "components/transactions/*.tsx",
      "lib/dashboard/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "react-hooks/refs": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
