import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

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

const sourceFiles = (directory: string): readonly string[] => {
  const entries = readdirSync(path.join(repositoryRoot, directory), {
    withFileTypes: true,
  });
  return entries.flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return entry.isFile() && entry.name.endsWith(".rs") ? [relative] : [];
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

if (failures.length > 0) {
  throw new Error(`Rust Core boundary audit failed:\n${failures.join("\n")}`);
}

console.log("Rust Core dependency boundaries: ok");
