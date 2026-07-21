import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const repositoryRoot = path.resolve(".");
const failures: string[] = [];

const read = (file: string): string =>
  readFileSync(path.join(repositoryRoot, file), "utf8");

const assertAbsent = (
  file: string,
  forbidden: readonly RegExp[],
  label: string,
): void => {
  const content = read(file);
  for (const pattern of forbidden) {
    if (pattern.test(content)) failures.push(`${label}: ${file} matches ${pattern}`);
  }
};

const sourceFiles = (
  directory: string,
  extensionPattern: RegExp = /\.rs$/,
): readonly string[] => {
  const entries = readdirSync(path.join(repositoryRoot, directory), {
    withFileTypes: true,
  });
  return entries.flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative, extensionPattern);
    return entry.isFile() && extensionPattern.test(entry.name) ? [relative] : [];
  });
};

assertAbsent(
  "crates/nodex-cli/Cargo.toml",
  [/\bnodex-core\s*=/, /\brusqlite\b/, /\byrs\b/],
  "native CLI must remain a protocol-only Adapter",
);
assertAbsent(
  "crates/nodex-core-protocol/Cargo.toml",
  [/\brusqlite\b/, /\byrs\b/],
  "protocol must not depend on store/document engines",
);

for (const moduleDirectory of [
  "administration",
  "automation",
  "database",
  "document",
  "library",
  "workspace",
]) {
  const directory = path.join(
    repositoryRoot,
    "crates/nodex-core/src",
    moduleDirectory,
  );
  if (!statSync(directory).isDirectory()) {
    failures.push(`missing vertical Module directory: ${directory}`);
    continue;
  }
  for (const file of sourceFiles(
    path.join("crates/nodex-core/src", moduleDirectory),
  )) {
    assertAbsent(
      file,
      [/\baxum\b/, /\bhyper\b/, /\bnodex_core_protocol\b/],
      "deep Module must not import an Adapter or transport",
    );
  }
}

for (const file of sourceFiles("crates/nodex-core-server/src")) {
  assertAbsent(
    file,
    [/\brusqlite\b/],
    "UDS routes must not import the SQLite implementation",
  );
}

for (const file of sourceFiles("src/main/core-client", /\.ts$/)) {
  assertAbsent(
    file,
    [/\bbetter-sqlite3\b/, /\bgetDb\s*\(/, /local-store\//, /\bfetch\s*\(/],
    "Electron Core client must remain a generated-protocol UDS Adapter",
  );
}

const productionMainFiles = sourceFiles("src/main", /\.ts$/).filter(
  (file) => !/\.(?:test|integration)(?:\.[^.]+)?\.ts$/.test(file),
);
for (const file of productionMainFiles) {
  assertAbsent(
    file,
    [/\bbetter-sqlite3\b/, /from\s+["']yjs["']/, /\bthread_search(?:_|\b)/],
    "Desktop Host must not contain a retired SQLite, Yjs, or Thread-search authority",
  );
}

const productionMainBundlePromise = build({
  entryPoints: [path.join(repositoryRoot, "src/main/bootstrap.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  write: false,
  metafile: true,
  logLevel: "silent",
});
const retiredDocumentAuthorityInputs = [
  "document-operation-engine.ts",
  "block-document-codec.ts",
  "legacy-nfm-shadow-translator.ts",
];
const auditProductionMainBundle = (
  productionMainBundle: Awaited<typeof productionMainBundlePromise>,
): void => {
  for (const [input, metadata] of Object.entries(productionMainBundle.metafile.inputs)) {
    const normalizedInput = input.replaceAll("\\", "/");
    for (const retiredInput of retiredDocumentAuthorityInputs) {
      if (normalizedInput.endsWith(`/${retiredInput}`)) {
        failures.push(`Desktop bootstrap transitively includes retired Document authority: ${input}`);
      }
    }
    for (const imported of metadata.imports) {
      if (imported.path === "yjs" || imported.path.startsWith("yjs/")) {
        failures.push(`Desktop bootstrap transitively imports Yjs from ${input}`);
      }
    }
  }
};

for (const file of [
  "src/main/http-server.ts",
  "src/shared/ipc-api.ts",
  "src/renderer/lib/browser-renderer-transport.ts",
]) {
  assertAbsent(
    file,
    [/\bdb:(?:query|schema)\b/, /\/api\/db\/(?:query|schema)\b/],
    "Desktop public transports must not expose arbitrary SQL inspection",
  );
}

const retainedLocalStoreFiles = new Set([
  "assets-deps.ts",
  "assets.test.ts",
  "assets.ts",
  "codex-scheduled-automation-schedule.test.ts",
  "codex-scheduled-automation-schedule.ts",
  "config.test.ts",
  "config.ts",
  "database-file-migration.test.ts",
  "database-file-migration.ts",
  "notifier.test.ts",
  "notifier.ts",
  "persisted-atoms.test.ts",
  "persisted-atoms.ts",
  "store-maintenance-gate.test.ts",
  "store-maintenance-gate.ts",
]);
for (const entry of readdirSync(path.join(repositoryRoot, "src/main/local-store"))) {
  if (retainedLocalStoreFiles.has(entry)) continue;
  failures.push(`obsolete local-store authority remains: src/main/local-store/${entry}`);
}

for (const file of sourceFiles("crates/nodex-core/src")) {
  assertAbsent(
    file,
    [/\bv83\b/i],
    "Core accepts only the v84 import boundary",
  );
}
assertAbsent(
  "crates/nodex-core/schema/v84.sql",
  [/\bthread_search(?:_|\b)/],
  "The final TypeScript import schema must not contain Thread search shadows",
);

const expectedRoutes = new Set([
  "/core/v1/admin/shutdown",
  "/core/v1/events",
  "/core/v1/handshake",
  "/core/v1/health",
  ...["administration", "automation", "database", "document", "library", "workspace"]
    .flatMap((module) => ["apply", "read"].map((operation) =>
      `/core/v1/modules/${module}/${operation}`)),
]);
const openApi = JSON.parse(read("packages/core-protocol/openapi.json")) as {
  readonly paths?: Readonly<Record<string, unknown>>;
};
const actualRoutes = new Set(Object.keys(openApi.paths ?? {}));
for (const route of expectedRoutes) {
  if (!actualRoutes.has(route)) failures.push(`missing Core protocol route: ${route}`);
}
for (const route of actualRoutes) {
  if (!expectedRoutes.has(route)) failures.push(`forbidden Core protocol route: ${route}`);
}

void productionMainBundlePromise.then((productionMainBundle) => {
  auditProductionMainBundle(productionMainBundle);
  if (failures.length > 0) {
    throw new Error(`Rust Core boundary audit failed:\n${failures.join("\n")}`);
  }

  console.log("Rust Core dependency boundaries: ok");
});
