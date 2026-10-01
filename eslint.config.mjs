import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
  {
    // The ORQO domain engine stays framework- and persistence-free so it runs
    // identically in the demo, on the server and in tests.
    files: ["src/lib/domain/**", "src/lib/engine/**", "src/lib/graph/**", "src/lib/i18n/**", "src/lib/entitlements/**", "src/lib/search/**", "src/lib/intelligence/**", "src/lib/agents/**", "src/lib/discovery/**", "src/lib/network/**", "src/lib/signals/**", "src/lib/events/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*", "next", "next/*", "@supabase/*", "@/lib/server/*", "@/lib/store", "@/lib/autodemo/*", "@/components/*", "@/app/*"],
              message: "The domain layer must not depend on UI, framework, persistence or server code.",
            },
          ],
        },
      ],
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
