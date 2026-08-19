import { defineConfig, globalIgnores } from "eslint/config";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import queryPlugin from "@tanstack/eslint-plugin-query";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const isBetterTailwindEnabled = process.env.ESLINT_BETTER_TAILWIND === "1";

const rendererRestrictedImportPaths = [
  {
    name: "@radix-ui/react-context-menu",
    message:
      "Use the app-owned deep context menu module from @/components/ui/context-menu.",
  },
  {
    name: "lucide-react",
    message:
      "Use app-owned icons from @/components/shared/icons or normalized generic glyphs from @/components/shared/icons/generic-icons.",
  },
];

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
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...rendererRestrictedImportPaths,
          ],
        },
      ],
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["src/renderer/components/ui/context-menu.tsx"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["src/renderer/components/shared/icons/generic-icons.tsx"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: [
      "src/renderer/**/*.test.tsx",
      "src/renderer/**/*.jsdom.test.ts",
      "src/renderer/**/*testkit*/**/*.{ts,tsx}",
    ],
    ignores: [
      "src/renderer/**/*.browser.test.tsx",
      "src/renderer/**/*.node.test.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: rendererRestrictedImportPaths,
          patterns: [
            {
              regex: "(?:^|/)shared/block-documents$",
              message:
                "Import the owning block-documents module directly so renderer tests do not load the complete schema barrel.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/renderer/components/workbench/workbench-shell.tsx",
      "src/renderer/components/workbench/workbench-panel-controls.tsx",
      "src/renderer/components/workbench/workbench-panel-surface.tsx",
      "src/renderer/components/workbench/workbench-db-view-panel.tsx",
      "src/renderer/components/workbench/workbench-page-stage-panel.tsx",
      "src/renderer/components/workbench/workbench-review-route-adapter.tsx",
      "src/renderer/components/workbench/workbench-session-thread-route.tsx",
      "src/renderer/components/workbench/workbench-runtime-panel-surfaces.tsx",
      "src/renderer/components/workbench/workbench-auxiliary-conversation-panels.tsx",
      "src/renderer/components/workbench/workbench-side-chat-panels.tsx",
      "src/renderer/components/workbench/workbench-session-sidebar.tsx",
    ],
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-refresh/only-export-components": "error",
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
