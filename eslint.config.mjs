import { defineConfig, globalIgnores } from "eslint/config";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import queryPlugin from "@tanstack/eslint-plugin-query";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const isBetterTailwindEnabled = process.env.ESLINT_BETTER_TAILWIND === "1";

const betterTailwindRecommendedRules = Object.fromEntries(
  Object.entries(betterTailwindcss.configs.recommended.rules)
    .filter(
      ([ruleName]) =>
        ruleName !== "better-tailwindcss/enforce-consistent-line-wrapping",
    )
    .map(([ruleName, severity]) => [
      ruleName,
      [
        severity,
        {
          entryPoint: "./src/renderer/globals.css",
          detectComponentClasses: true,
          ...(ruleName === "better-tailwindcss/no-unknown-classes"
            ? {
              ignore: [
                "^excalidraw-button$",
                "^slide-in-from-top-0\\.5$",
                "^nfm-",
                "^bn-",
                "^nodex-",
                "^codex-",
              ],
            }
            : {}),
        },
      ],
    ]),
);

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  ...(Array.isArray(queryPlugin.configs["flat/recommended"])
    ? queryPlugin.configs["flat/recommended"]
    : [queryPlugin.configs["flat/recommended"]]),
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  ...(isBetterTailwindEnabled
    ? [
      {
        files: ["src/renderer/**/*.{ts,tsx}"],
        plugins: betterTailwindcss.configs.recommended.plugins,
        rules: betterTailwindRecommendedRules,
      },
    ]
    : []),
  globalIgnores(["out/**", "dist/**", "build/**"]),
]);

export default eslintConfig;
