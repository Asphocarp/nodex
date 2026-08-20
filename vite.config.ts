import { defineConfig } from "vite-plus";

const toolingFixtureMode = process.env.NODEX_TOOLING_FIXTURE_MODE === "1";
const generatedOrExternalPaths = [
  ".cache/**",
  ".generated/**",
  ".vite-plus/**",
  "build/**",
  "coverage/**",
  "dist/**",
  "node_modules/**",
  "out/**",
  "packages/*/dist/**",
  "packages/codex-app-server-protocol/src/v2/**",
  "packages/storybook/storybook-static/**",
  "pnpm-lock.yaml",
  "playwright-report/**",
  "scripts/fixtures/tooling/**",
  "scripts/scenarios/artifacts/**",
  "src/renderer/generated/**",
  "test-results/**",
  "third_party/**",
];

// These files remain runnable artifacts, but they were deliberately outside the
// previous `tsc -b` project graph. Keep the TS7 migration scoped to that graph.
const nonProjectSources = [
  "**/*.cjs",
  "**/*.js",
  "**/*.mjs",
  "config/**/*.test.ts",
  "scripts/**/*.test.ts",
];

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

const tanstackQueryRules = {
  "@tanstack/query/exhaustive-deps": "error",
  "@tanstack/query/infinite-query-property-order": "error",
  "@tanstack/query/mutation-property-order": "error",
  "@tanstack/query/no-rest-destructuring": "warn",
  "@tanstack/query/no-unstable-deps": "error",
  "@tanstack/query/no-void-query-fn": "error",
  "@tanstack/query/stable-query-client": "error",
} as const;

const betterTailwindEnabled = process.env.ESLINT_BETTER_TAILWIND === "1";
const betterTailwindOptions = {
  detectComponentClasses: true,
  entryPoint: "./src/renderer/globals.css",
};
const pluginRule = <Options>(
  severity: "error" | "warn",
  options: Options,
): ["error" | "warn", Options] => [severity, options];
const betterTailwindRules = betterTailwindEnabled
  ? {
    "better-tailwindcss/enforce-canonical-classes": pluginRule("warn", betterTailwindOptions),
    "better-tailwindcss/enforce-consistent-class-order": pluginRule("warn", betterTailwindOptions),
    "better-tailwindcss/no-conflicting-classes": pluginRule("error", betterTailwindOptions),
    "better-tailwindcss/no-deprecated-classes": pluginRule("warn", betterTailwindOptions),
    "better-tailwindcss/no-duplicate-classes": pluginRule("warn", betterTailwindOptions),
    "better-tailwindcss/no-unknown-classes": pluginRule(
      "error",
      {
        ...betterTailwindOptions,
        ignore: [
          "^excalidraw-button$",
          "^slide-in-from-top-0\\.5$",
          "^nfm-",
          "^bn-",
          "^nodex-",
          "^codex-",
        ],
      },
    ),
    "better-tailwindcss/no-unnecessary-whitespace": pluginRule("warn", betterTailwindOptions),
  }
  : {};

const workbenchRefreshBoundaries = [
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
];

export default defineConfig({
  lint: {
    ignorePatterns: [
      ...generatedOrExternalPaths.filter(
        (path) => !toolingFixtureMode || path !== "scripts/fixtures/tooling/**",
      ),
      ...nonProjectSources.filter(
        (path) => !toolingFixtureMode || path !== "scripts/**/*.test.ts",
      ),
    ],
    jsPlugins: [
      { name: "@tanstack/query", specifier: "@tanstack/eslint-plugin-query" },
      ...(betterTailwindEnabled
        ? [{ name: "better-tailwindcss", specifier: "eslint-plugin-better-tailwindcss" }]
        : []),
    ],
    options: {
      typeAware: !toolingFixtureMode,
      typeCheck: !toolingFixtureMode,
    },
    plugins: ["eslint", "oxc", "react", "typescript", "unicorn"],
    rules: {
      ...tanstackQueryRules,
      ...betterTailwindRules,
    },
    overrides: [
      {
        files: [
          "src/renderer/**/*.{ts,tsx}",
          "scripts/fixtures/tooling/renderer/**/*.{ts,tsx}",
        ],
        rules: {
          "no-restricted-imports": ["error", { paths: rendererRestrictedImportPaths }],
          "react/exhaustive-deps": "error",
          "react/rules-of-hooks": "error",
        },
      },
      {
        files: [
          "src/renderer/**/*.test.tsx",
          "src/renderer/**/*.jsdom.test.ts",
          "src/renderer/**/*testkit*/**/*.{ts,tsx}",
          "scripts/fixtures/tooling/renderer-tests/**/*.{ts,tsx}",
        ],
        excludeFiles: [
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
          ...workbenchRefreshBoundaries,
          "scripts/fixtures/tooling/workbench/**/*.{ts,tsx}",
        ],
        rules: {
          "react/only-export-components": "error",
        },
      },
      {
        files: [
          "src/renderer/components/ui/context-menu.tsx",
          "src/renderer/components/shared/icons/generic-icons.tsx",
        ],
        rules: {
          "no-restricted-imports": "off",
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: generatedOrExternalPaths,
  },
  staged: {
    "*.{cjs,css,html,js,json,jsx,jsonc,md,mjs,scss,ts,tsx,yaml,yml}": "vp fmt",
  },
});
