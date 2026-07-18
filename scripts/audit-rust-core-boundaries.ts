import { readFileSync, statSync } from "node:fs";
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
  }
}

if (failures.length > 0) {
  throw new Error(`Rust Core boundary audit failed:\n${failures.join("\n")}`);
}

console.log("Rust Core dependency boundaries: ok");

