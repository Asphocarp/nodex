import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ChangeClassification {
  readonly app: boolean;
  readonly dependencyKind: "editor" | "github-actions" | "javascript" | "none" | "rust" | "source";
  readonly browser: boolean;
  readonly docsOnly: boolean;
  readonly electronMain: boolean;
  readonly fullRequired: boolean;
  readonly landingOnly: boolean;
  readonly migration: boolean;
  readonly protocol: boolean;
  readonly releaseMetadata: boolean;
  readonly renderer: boolean;
  readonly rust: boolean;
  readonly runtime: boolean;
  readonly storage: boolean;
  readonly stressRelevant: boolean;
}

const RELEASE_PATHS = new Set([
  "Cargo.lock",
  "Cargo.toml",
  "CHANGELOG.md",
  "package.json",
]);

const isDocumentationPath = (path: string): boolean =>
  path === "AGENTS.md"
  || path === "docs/ARCHITECTURE.md"
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
  || path.startsWith(".github/workflows/")
  || path.startsWith(".github/actions/")
  || path.startsWith("crates/")
  || path.startsWith("packages/codex-app-server-protocol/")
  || path.startsWith("resources/agent-runtime/")
  || path.startsWith("resources/browser-runtime/")
  || path.startsWith("resources/macos/")
  || path.startsWith("scripts/ci/")
  || path.startsWith("scripts/legacy-profile-migrator/")
  || path === "scripts/build-resources.ts"
  || path === "scripts/build-legacy-profile-migrator.ts"
  || path === "scripts/generate-third-party-notices.ts"
  || path === "scripts/legacy-profile-migrator-artifacts.ts"
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
  || path.startsWith("config/renderer-vite")
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
  || path.startsWith("crates/")
  || path.startsWith("scripts/legacy-profile-migrator/")
  || path === "scripts/build-legacy-profile-migrator.ts";

const isStoragePath = (path: string): boolean =>
  path.startsWith("crates/nodex-core/src/infrastructure/")
  || path.startsWith("crates/nodex-core/schema/")
  || path.startsWith("crates/nodex-store-format/")
  || path.startsWith("resources/legacy-profile-migrator/")
  || path.startsWith("scripts/legacy-profile-migrator/")
  || path === "scripts/build-resources.ts"
  || path === "scripts/build-legacy-profile-migrator.ts"
  || path === "scripts/generate-third-party-notices.ts"
  || path === "scripts/legacy-profile-migrator-artifacts.ts"
  || path === "src/shared/build-resources.ts";

const isMigrationPath = (path: string): boolean =>
  path === "crates/nodex-core/src/infrastructure/migration.rs"
  || path === "crates/nodex-core/src/infrastructure/legacy_migration.rs"
  || path.startsWith("crates/nodex-core/schema/")
  || path.startsWith("crates/nodex-store-format/")
  || path.startsWith("resources/legacy-profile-migrator/")
  || path.startsWith("scripts/legacy-profile-migrator/")
  || path === "scripts/build-resources.ts"
  || path === "scripts/build-legacy-profile-migrator.ts"
  || path === "scripts/generate-third-party-notices.ts"
  || path === "scripts/legacy-profile-migrator-artifacts.ts"
  || path === "src/shared/build-resources.ts";

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

const isFullRequiredPath = (path: string): boolean =>
  RELEASE_PATHS.has(path)
  || path === "pnpm-lock.yaml"
  || path === "rust-toolchain.toml"
  || path.startsWith(".github/workflows/")
  || path.startsWith(".github/actions/")
  || path.startsWith("scripts/ci/");

const isKnownAppPath = (path: string): boolean =>
  path.startsWith("src/")
  || path.startsWith("packages/storybook/")
  || path.startsWith("scripts/")
  || path.startsWith("resources/")
  || path.startsWith("crates/")
  || path.startsWith(".config/")
  || path.startsWith(".github/")
  || path.startsWith("playwright")
  || path.startsWith("vitest")
  || path.startsWith("tsconfig")
  || path === "electron.vite.config.ts"
  || path === "electron-builder.yml"
  || path === "pnpm-workspace.yaml";

const isGitHubActionPath = (path: string): boolean =>
  path.startsWith(".github/workflows/")
  || path.startsWith(".github/actions/");

const isRustDependencyPath = (path: string): boolean =>
  path === "Cargo.lock"
  || path === "Cargo.toml"
  || (/^crates\/[^/]+\/Cargo\.toml$/u.test(path));

const isJavaScriptDependencyPath = (path: string): boolean =>
  path === "package.json"
  || path === "pnpm-lock.yaml"
  || /^(?:packages|third_party\/blocknote\/packages)\/[^/]+\/package\.json$/u.test(path);

const isEditorDependencyPath = (path: string): boolean =>
  path.startsWith("third_party/blocknote/") && path.endsWith("/package.json");

const dependencyKindFor = (
  paths: readonly string[],
): ChangeClassification["dependencyKind"] => {
  if (paths.length === 0) return "source";
  if (paths.every(isGitHubActionPath)) return "github-actions";
  if (paths.every(isRustDependencyPath)) return "rust";
  if (paths.every(isJavaScriptDependencyPath)) {
    return paths.some(isEditorDependencyPath) ? "editor" : "javascript";
  }
  return "none";
};

const normalizePath = (value: string): string => {
  const path = value.trim().replaceAll("\\", "/");
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`Changed path is invalid: ${JSON.stringify(value)}.`);
  }
  return path.replace(/^\.\//u, "");
};

export function classifyChangedPaths(
  changedPaths: readonly string[],
  options: { readonly full?: boolean } = {},
): ChangeClassification {
  const paths = [...new Set(changedPaths.map(normalizePath))];
  if (options.full || paths.length === 0) {
    return {
      app: true,
      dependencyKind: "source",
      browser: true,
      docsOnly: false,
      electronMain: true,
      fullRequired: true,
      landingOnly: false,
      migration: true,
      protocol: true,
      releaseMetadata: false,
      renderer: true,
      rust: true,
      runtime: true,
      storage: true,
      stressRelevant: true,
    };
  }

  const releaseMetadata = paths.length === RELEASE_PATHS.size
    && [...RELEASE_PATHS].every((path) => paths.includes(path));
  const docsOnly = !releaseMetadata && paths.every(isDocumentationPath);
  const landingOnly = !releaseMetadata && paths.every(isLandingPath);
  const hasUnknownPath = paths.some((path) => (
    !isDocumentationPath(path)
    && !isLandingPath(path)
    && !isKnownAppPath(path)
    && !RELEASE_PATHS.has(path)
  ));
  const fullRequired = !releaseMetadata
    && (paths.some(isFullRequiredPath) || hasUnknownPath);
  const dependencyKind = dependencyKindFor(paths);

  return {
    app: !releaseMetadata && !docsOnly && !landingOnly,
    dependencyKind,
    browser: paths.some(isBrowserPath),
    docsOnly,
    electronMain: paths.some(isElectronMainPath),
    fullRequired,
    landingOnly,
    migration: paths.some(isMigrationPath),
    protocol: paths.some(isProtocolPath),
    releaseMetadata,
    renderer: paths.some(isRendererPath),
    rust: !releaseMetadata && paths.some(isRustPath),
    runtime: !releaseMetadata && (hasUnknownPath || paths.some(isRuntimePath)),
    storage: paths.some(isStoragePath),
    stressRelevant: !releaseMetadata && paths.some(isStressRelevantPath),
  };
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
  const classification = classifyChangedPaths(paths, { full: args.includes("--full") });
  const destination = readOption(args, "--output");
  const serialized = `${JSON.stringify({ ...classification, changedPaths: paths }, null, 2)}\n`;
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
