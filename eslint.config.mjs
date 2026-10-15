import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "app/**",
    "web/dist/**",
    // Flutter preview output is generated JavaScript, not application source.
    "web/public/app-preview/**",
    "**/dist-node/**",
    "**/dist/**",
    "**/.sites-runtime/**",
    "**/.next/**",
    "**/.vinext/**",
    "**/.wrangler/**",
    "backend/backend_web/dist/**",
    "next-env.d.ts",
  ]),
  {
    files: ["backend/api/user_account/**/*.{js,cjs}"],
    rules: {
      // This independent service uses CommonJS; keep its other checks enabled.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["web/components/ui/**/*.{ts,tsx}", "web/hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
