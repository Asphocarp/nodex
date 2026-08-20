import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_TEST_SUITES,
  assertCiGatePlan,
  STATIC_GROUPS,
  type CiGatePlan,
  type DependencyKind,
  type StaticGroup,
} from "./ci-gate-plan.ts";

export type {
  AppTestSuite,
  CiGatePlan,
  DependencyKind,
  StaticGroup,
} from "./ci-gate-plan.ts";

const RELEASE_PATHS = new Set(["Cargo.lock", "Cargo.toml", "CHANGELOG.md", "package.json"]);

const isDocumentationPath = (path: string): boolean =>
  path === "AGENTS.md"
  || path === "CONTEXT.md"
  || path.endsWith(".md")
  || path.startsWith("docs/");

const isLandingPath = (path: string): boolean =>
  path.startsWith("packages/landing/")
  || path === ".github/workflows/deploy-landing-site.yml";

const isRuntimePath = (path: string): boolean =>
  path === "Cargo.lock"
  || path === "Cargo.toml"
  || path === "electron-builder.yml"
  || path === "package.json"
  || path === "pnpm-lock.yaml"
  || path === "rust-toolchain.toml"
  || path.startsWith("crates/")
  || path.startsWith("packages/codex-app-server-protocol/")
  || path.startsWith("resources/agent-runtime/")
  || path.startsWith("resources/browser-runtime/")
  || path.startsWith("resources/macos/")
  || path === "scripts/build-resources.ts"
  || path === "scripts/generate-third-party-notices.ts"
  || path.startsWith("scripts/release/")
  || /^(scripts\/(archive|materialize|probe|sign|stage|verify)-.*runtime)/u.test(path)
  || path.startsWith("src/main/codex/")
  || path.startsWith("src/main/core-client/")
  || path === "src/shared/build-resources.ts"
  || path.startsWith("src/shared/codex-")
  || path.startsWith("src/shared/core-");

const isRendererPath = (path: string): boolean =>
  path.startsWith("src/renderer/")
  || path.startsWith("packages/storybook/")
  || path.startsWith("src/shared/")
  || path.startsWith("config/renderer-")
  || path.startsWith("vitest.renderer")
  || path.startsWith("vitest.browser");

const isElectronMainPath = (path: string): boolean =>
  path.startsWith("src/main/")
  || path.startsWith("src/preload/")
  || path === "electron.vite.config.ts"
  || path === "electron-builder.yml"
  || path === "scripts/run-vitest-in-electron.mjs"
  || path.startsWith("scripts/scenarios/")
  || path.startsWith("tests/e2e/");

const isBrowserPath = (path: string): boolean =>
  isRendererPath(path)
  || path.startsWith("tests/e2e/")
  || path.startsWith("vitest.browser")
  || path.startsWith("playwright");

const isRustPath = (path: string): boolean =>
  path === "Cargo.toml"
  || path === "Cargo.lock"
  || path === "rust-toolchain.toml"
  || path.startsWith("crates/");

const isStoragePath = (path: string): boolean =>
  path.startsWith("crates/nodex-core/src/infrastructure/")
  || path.startsWith("crates/nodex-core/schema/")
  || path.startsWith("crates/nodex-store-format/");

const isMigrationPath = (path: string): boolean =>
  path === "crates/nodex-core/src/infrastructure/migration.rs"
  || path.startsWith("crates/nodex-core/schema/")
  || path.startsWith("crates/nodex-store-format/");

const isProtocolPath = (path: string): boolean =>
  path.startsWith("crates/nodex-core-contracts/")
  || path.startsWith("crates/nodex-core-protocol/")
  || path.startsWith("packages/codex-app-server-protocol/")
  || path.startsWith("packages/core-protocol/")
  || path.startsWith("src/shared/core-")
  || path.startsWith("src/shared/codex-")
  || path.startsWith("src/main/core-client/");

const isStressInfrastructurePath = (path: string): boolean =>
  path.startsWith("vitest.")
  || path.startsWith("config/vitest-")
  || path === "config/electron-test-runtime.ts"
  || path === "scripts/run-vitest-in-electron.mjs";

const isStressRelevantPath = (path: string): boolean =>
  isRustPath(path)
  || isStoragePath(path)
  || isStressInfrastructurePath(path)
  || path.includes(".stress.")
  || path.includes("performance")
  || path.includes("concurrency")
  || path.includes("scheduler")
  || path.includes("lifecycle")
  || path.includes("canvas")
  || path.startsWith("src/main/core-client/")
  || path.startsWith("src/main/codex/");

const isGeneratedResourcePath = (path: string): boolean =>
  path === "scripts/build-resources.ts"
  || path === "scripts/generate-third-party-notices.ts"
  || path === "src/shared/build-resources.ts"
  || path.startsWith("resources/");

const isKnownAppPath = (path: string): boolean =>
  path.startsWith("src/")
  || path.startsWith("packages/")
  || path.startsWith("third_party/")
  || path.startsWith("scripts/")
  || path.startsWith("resources/")
  || path.startsWith("crates/")
  || path.startsWith(".config/")
  || path.startsWith("playwright")
  || path.startsWith("vitest")
  || path.startsWith("tsconfig")
  || path === "electron.vite.config.ts"
  || path === "electron-builder.yml"
  || path === "pnpm-workspace.yaml";

const isGitHubPath = (path: string): boolean => path.startsWith(".github/");

const isRustDependencyPath = (path: string): boolean =>
  path === "Cargo.lock"
  || path === "Cargo.toml"
  || /^crates\/[^/]+\/Cargo\.toml$/u.test(path);

const isJavaScriptDependencyPath = (path: string): boolean =>
  path === "package.json"
  || path === "pnpm-lock.yaml"
  || /^(?:packages|third_party\/blocknote\/packages)\/[^/]+\/package\.json$/u.test(path);

const dependencyKindFor = (paths: readonly string[]): DependencyKind => {
  if (paths.length === 0) return "source";
  if (paths.every(isGitHubPath)) return "github-actions";
  if (paths.every(isRustDependencyPath)) return "rust";
  if (!paths.every(isJavaScriptDependencyPath)) return "none";
  return paths.some((path) => path.startsWith("third_party/blocknote/")) ? "editor" : "javascript";
};

const normalizePath = (value: string): string => {
  const path = value.trim().replaceAll("\\", "/");
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`Changed path is invalid: ${JSON.stringify(value)}.`);
  }
  return path.replace(/^\.\//u, "");
};

const createPlan = (overrides: Partial<CiGatePlan>): CiGatePlan => {
  const candidate: CiGatePlan = {
    allGates: false,
    appTestSuites: [],
    browser: false,
    dependencyKind: "none",
    docsOnly: false,
    electronE2e: false,
    landingOnly: false,
    protocolContracts: false,
    releaseTransition: false,
    runtimeMac: false,
    rustFast: false,
    rustMigration: false,
    staticGroups: [],
    stress: false,
    ...overrides,
  };
  assertCiGatePlan(candidate);
  return candidate;
};

const allGatesPlan = (dependencyKind: DependencyKind, allGates = true): CiGatePlan => createPlan({
  allGates,
  appTestSuites: APP_TEST_SUITES,
  browser: true,
  dependencyKind,
  electronE2e: true,
  protocolContracts: true,
  runtimeMac: true,
  rustFast: true,
  rustMigration: true,
  staticGroups: STATIC_GROUPS,
  stress: true,
});

const githubActionPlan = (paths: readonly string[]): CiGatePlan => {
  if (paths.some((path) => path.startsWith(".github/workflows/"))) {
    return allGatesPlan("github-actions");
  }
  if (paths.every((path) => path === ".github/actions/run-stress-tests/action.yml")) {
    return createPlan({
      dependencyKind: "github-actions",
      staticGroups: ["ci-contracts"],
      stress: true,
    });
  }
  if (paths.every((path) => path === ".github/actions/setup-playwright/action.yml")) {
    return createPlan({
      browser: true,
      dependencyKind: "github-actions",
      electronE2e: true,
      staticGroups: ["ci-contracts"],
      stress: true,
    });
  }
  if (paths.every((path) => path === ".github/actions/setup-rust-ci/action.yml")) {
    return createPlan({
      appTestSuites: APP_TEST_SUITES,
      dependencyKind: "github-actions",
      electronE2e: true,
      protocolContracts: true,
      runtimeMac: true,
      rustFast: true,
      rustMigration: true,
      staticGroups: ["ci-contracts", "repository-contracts"],
      stress: true,
    });
  }
  return allGatesPlan("github-actions");
};

const sourcePlan = (paths: readonly string[], dependencyKind: DependencyKind): CiGatePlan => {
  const renderer = paths.some(isRendererPath);
  const electronMain = paths.some(isElectronMainPath);
  const rust = paths.some(isRustPath);
  const migration = paths.some(isMigrationPath);
  const protocol = paths.some(isProtocolPath);
  const browser = paths.some(isBrowserPath);
  const staticGroups = new Set<StaticGroup>(["types"]);
  if (renderer) staticGroups.add("ui-contracts");
  if (electronMain || rust || protocol) staticGroups.add("repository-contracts");
  if (paths.some(isGeneratedResourcePath)) staticGroups.add("generated");
  return createPlan({
    appTestSuites: APP_TEST_SUITES,
    browser,
    dependencyKind,
    electronE2e: electronMain || browser,
    protocolContracts: protocol,
    runtimeMac: paths.some(isRuntimePath),
    rustFast: rust || protocol,
    rustMigration: migration,
    staticGroups: [...staticGroups],
    stress: paths.some(isStressRelevantPath),
  });
};

export function classifyChangedPaths(
  changedPaths: readonly string[],
  options: { readonly full?: boolean } = {},
): CiGatePlan {
  const paths = [...new Set(changedPaths.map(normalizePath))];
  if (options.full || paths.length === 0) return allGatesPlan("source");

  const releaseTransition = paths.length === RELEASE_PATHS.size
    && [...RELEASE_PATHS].every((path) => paths.includes(path));
  if (releaseTransition) return createPlan({ releaseTransition: true });

  if (paths.every(isDocumentationPath)) return createPlan({ docsOnly: true });
  const landingOnly = paths.some(isLandingPath)
    && paths.every((path) => isLandingPath(path) || isDocumentationPath(path));
  if (landingOnly) return createPlan({ landingOnly: true, staticGroups: ["landing"] });

  const dependencyKind = dependencyKindFor(paths);
  if (dependencyKind === "github-actions") return githubActionPlan(paths);
  if (dependencyKind === "javascript" || dependencyKind === "editor") {
    return allGatesPlan(dependencyKind, false);
  }
  if (dependencyKind === "rust") {
    return createPlan({
      appTestSuites: APP_TEST_SUITES,
      dependencyKind,
      electronE2e: true,
      protocolContracts: true,
      runtimeMac: true,
      rustFast: true,
      rustMigration: true,
      staticGroups: ["repository-contracts", "generated"],
      stress: true,
    });
  }

  const hasUnknownPath = paths.some((path) => (
    !isDocumentationPath(path)
    && !isLandingPath(path)
    && !isKnownAppPath(path)
    && !RELEASE_PATHS.has(path)
  ));
  if (hasUnknownPath || paths.some((path) => path.startsWith("scripts/ci/"))) {
    return allGatesPlan(dependencyKind === "none" ? "source" : dependencyKind);
  }
  return sourcePlan(paths, dependencyKind);
}

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
};

const main = (): void => {
  const args = process.argv.slice(2);
  const base = readOption(args, "--base");
  const head = readOption(args, "--head") ?? "HEAD";
  if (!base) throw new Error("Usage: classify-change --base <sha> [--head <sha>] [--full] [--output <path>].");
  const cwd = resolve(import.meta.dirname, "../..");
  const output = execFileSync("git", ["diff", "--name-only", "-z", `${base}..${head}`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const paths = output.split("\0").filter(Boolean);
  const gatePlan = classifyChangedPaths(paths, { full: args.includes("--full") });
  const serialized = `${JSON.stringify({ changedPaths: paths, plan: gatePlan }, null, 2)}\n`;
  const destination = readOption(args, "--output");
  if (!destination) {
    process.stdout.write(serialized);
    return;
  }
  const outputPath = resolve(destination);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
