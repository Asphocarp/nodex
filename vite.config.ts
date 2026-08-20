import { defineConfig } from "vite-plus";
import { recommended as effectRecommended } from "@effect/tsgo/oxlint-presets";

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
  "packages/codex-app-server-protocol/runtime-schemas/**",
  "packages/codex-app-server-protocol/src/**",
  "packages/core-protocol/openapi.json",
  "packages/core-protocol/src/compatibility.generated.ts",
  "packages/core-protocol/src/generated.ts",
  "packages/storybook/storybook-static/**",
  "pnpm-lock.yaml",
  "playwright-report/**",
  "scripts/fixtures/tooling/**",
  "scripts/scenarios/artifacts/**",
  "src/renderer/generated/**",
  "src/renderer/**/*.generated.*",
  "**/fixtures/**",
  "**/test-fixtures/**",
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
    message: "Use the app-owned deep context menu module from @/components/ui/context-menu.",
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
  "@tanstack/query/no-rest-destructuring": "error",
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
      "better-tailwindcss/enforce-consistent-class-order": pluginRule(
        "warn",
        betterTailwindOptions,
      ),
      "better-tailwindcss/no-conflicting-classes": pluginRule("error", betterTailwindOptions),
      "better-tailwindcss/no-deprecated-classes": pluginRule("warn", betterTailwindOptions),
      "better-tailwindcss/no-duplicate-classes": pluginRule("warn", betterTailwindOptions),
      "better-tailwindcss/no-unknown-classes": pluginRule("error", {
        ...betterTailwindOptions,
        ignore: [
          "^excalidraw-button$",
          "^slide-in-from-top-0\\.5$",
          "^nfm-",
          "^bn-",
          "^nodex-",
          "^codex-",
        ],
      }),
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

const toolingFixtureIgnorePatterns = new Set(["scripts/fixtures/tooling/**", "**/fixtures/**"]);
const effectControlPlaneFiles = [
  "src/main/effect-control-plane/**/*.{ts,tsx}",
  "src/main/effect-adapters/**/*.{ts,tsx}",
  "src/main/main-program*.ts",
  "scripts/effect-control-plane/**/*.ts",
  "scripts/effect-adapters/**/*.ts",
];

export default defineConfig({
  lint: {
    ignorePatterns: [
      ...generatedOrExternalPaths.filter(
        (path) => !toolingFixtureMode || !toolingFixtureIgnorePatterns.has(path),
      ),
      ...nonProjectSources.filter((path) => !toolingFixtureMode || path !== "scripts/**/*.test.ts"),
    ],
    jsPlugins: [
      "./oxlint-plugin-nodex/index.ts",
      { name: "@tanstack/query", specifier: "@tanstack/eslint-plugin-query" },
      ...(betterTailwindEnabled
        ? [{ name: "better-tailwindcss", specifier: "eslint-plugin-better-tailwindcss" }]
        : []),
    ],
    options: {
      typeAware: !toolingFixtureMode,
      typeCheck: !toolingFixtureMode,
    },
    plugins: ["effecttsgo", "eslint", "oxc", "react", "typescript", "unicorn"],
    rules: {
      // These broad heuristics consume the diagnostic budget without expressing
      // a stable Nodex invariant. Keep correctness rules below strict instead.
      "eslint/no-control-regex": "off",
      "eslint/no-empty-pattern": "off",
      "eslint/no-useless-escape": "off",
      "react/no-children-prop": "off",
      "react/react-in-jsx-scope": "off",
      "typescript/await-thenable": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-duplicate-type-constituents": "off",
      "typescript/no-meaningless-void-operator": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/unbound-method": "off",
      "unicorn/no-new-array": "off",
      "unicorn/no-useless-fallback-in-spread": "off",
      "unicorn/no-useless-spread": "off",

      // A clean default result makes every diagnostic actionable for humans and agents.
      "eslint/no-extra-boolean-cast": "error",
      "eslint/no-unreachable": "error",
      "eslint/no-unsafe-finally": "error",
      "eslint/no-unsafe-optional-chaining": "error",
      "nodex/no-manual-effect-runtime-in-tests": "error",
      "nodex/no-native-title-tooltip": "error",
      "oxc/const-comparisons": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-spread": "error",
      "typescript/require-array-sort-compare": "error",
      ...tanstackQueryRules,
      ...betterTailwindRules,
    },
    overrides: [
      {
        files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
        rules: {
          // Test assertions deliberately probe nullable values and cleanup failures.
          "eslint/no-unsafe-finally": "off",
          "eslint/no-unsafe-optional-chaining": "off",
        },
      },
      {
        files: ["src/main/core-client/isolated-run-ownership.ts", "src/main/local-store/assets.ts"],
        rules: {
          // Cleanup failure is intentionally fatal on these durability boundaries.
          "eslint/no-unsafe-finally": "off",
        },
      },
      {
        files: ["src/renderer/**/*.{ts,tsx}", "scripts/fixtures/tooling/renderer/**/*.{ts,tsx}"],
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
        excludeFiles: ["src/renderer/**/*.browser.test.tsx", "src/renderer/**/*.node.test.tsx"],
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
        files: [...workbenchRefreshBoundaries, "scripts/fixtures/tooling/workbench/**/*.{ts,tsx}"],
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
      {
        files: effectControlPlaneFiles,
        rules: effectRecommended.rules,
      },
      {
        files: ["src/main/effect-adapters/**/*.{ts,tsx}", "scripts/effect-adapters/**/*.ts"],
        rules: {
          ...effectRecommended.rules,
          // These app-owned adapters are the intentional Node/platform frontier.
          "effecttsgo/global-random": "off",
          "effecttsgo/node-builtin-import": "off",
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: generatedOrExternalPaths,
    sortPackageJson: {},
  },
  staged: {
    "*": "vp fmt",
  },
});
