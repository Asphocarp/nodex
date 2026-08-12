import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ChangeClassification {
  readonly app: boolean;
  readonly docsOnly: boolean;
  readonly landingOnly: boolean;
  readonly releaseMetadata: boolean;
  readonly runtime: boolean;
}

const RELEASE_PATHS = new Set([
  "Cargo.lock",
  "Cargo.toml",
  "CHANGELOG.md",
  "package.json",
]);

const RELEASE_IDENTITY_PATHS = new Set([
  "Cargo.lock",
  "Cargo.toml",
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
  || path.startsWith("crates/")
  || path.startsWith("packages/codex-app-server-protocol/")
  || path.startsWith("resources/agent-runtime/")
  || path.startsWith("resources/browser-runtime/")
  || path.startsWith("resources/macos/")
  || path.startsWith("scripts/release/")
  || /^(scripts\/(archive|materialize|probe|sign|stage|verify)-.*runtime)/u.test(path)
  || path.startsWith("src/main/codex/")
  || path.startsWith("src/main/core-client/")
  || path.startsWith("src/shared/codex-")
  || path.startsWith("src/shared/core-");

const isKnownAppPath = (path: string): boolean =>
  path.startsWith("src/")
  || path.startsWith("packages/storybook/")
  || path.startsWith("scripts/")
  || path.startsWith("resources/")
  || path.startsWith("crates/")
  || path.startsWith("playwright")
  || path.startsWith("vitest")
  || path.startsWith("tsconfig")
  || path === "electron.vite.config.ts"
  || path === "electron-builder.yml"
  || path === "pnpm-workspace.yaml";

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
      docsOnly: false,
      landingOnly: false,
      releaseMetadata: false,
      runtime: true,
    };
  }

  const releaseMetadata = paths.every((path) => RELEASE_PATHS.has(path))
    && paths.some((path) => RELEASE_IDENTITY_PATHS.has(path));
  const docsOnly = !releaseMetadata && paths.every(isDocumentationPath);
  const landingOnly = !releaseMetadata && paths.every(isLandingPath);
  const hasUnknownPath = paths.some((path) => (
    !isDocumentationPath(path)
    && !isLandingPath(path)
    && !isKnownAppPath(path)
    && !RELEASE_PATHS.has(path)
  ));

  return {
    app: releaseMetadata || (!docsOnly && !landingOnly),
    docsOnly,
    landingOnly,
    releaseMetadata,
    runtime: releaseMetadata || hasUnknownPath || paths.some(isRuntimePath),
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
