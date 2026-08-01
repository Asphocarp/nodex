#!/usr/bin/env tsx

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { applyCodexFeatureDefaults } from "../src/main/codex/codex-feature-defaults";

type UnknownRecord = Record<string, unknown>;

const NODEX_OWNED_SHELL_ENVIRONMENT_KEYS = [
  "BROWSER_USE_AVAILABLE_BACKENDS",
  "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S",
  "NODE_REPL_TRUSTED_CODE_PATHS",
] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deleteEmptyRecord(parent: UnknownRecord, key: string): void {
  const value = parent[key];
  if (isRecord(value) && Object.keys(value).length === 0) delete parent[key];
}

export function sanitizeIsolatedCodexConfig(config: UnknownRecord): UnknownRecord {
  const mcpServers = config.mcp_servers;
  if (isRecord(mcpServers)) {
    delete mcpServers.node_repl;
    deleteEmptyRecord(config, "mcp_servers");
  }

  const shellEnvironmentPolicy = config.shell_environment_policy;
  if (!isRecord(shellEnvironmentPolicy)) return config;

  const environment = shellEnvironmentPolicy.set;
  if (isRecord(environment)) {
    for (const key of NODEX_OWNED_SHELL_ENVIRONMENT_KEYS) delete environment[key];
    deleteEmptyRecord(shellEnvironmentPolicy, "set");
  }
  deleteEmptyRecord(config, "shell_environment_policy");
  return config;
}

export async function copyIsolatedCodexConfig(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const parsed = parseToml(await readFile(sourcePath, "utf8"), {
    integersAsBigInt: true,
  });
  if (!isRecord(parsed)) throw new Error("Codex config root must be a TOML table");

  const sanitized = sanitizeIsolatedCodexConfig(parsed);
  const withFeatureDefaults = applyCodexFeatureDefaults(sanitized);
  await writeFile(
    targetPath,
    stringifyToml(withFeatureDefaults.config, { numbersAsFloat: true }),
    { encoding: "utf8", mode: 0o600 },
  );
}

function isDirectExecution(): boolean {
  const scriptPath = process.argv[1];
  return typeof scriptPath === "string"
    && path.resolve(scriptPath) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  const [sourcePath, targetPath] = process.argv.slice(2);
  if (!sourcePath || !targetPath) {
    process.stderr.write(
      "Usage: copy-isolated-codex-config.ts <source-config> <target-config>\n",
    );
    process.exitCode = 1;
  } else {
    copyIsolatedCodexConfig(sourcePath, targetPath).catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
  }
}
