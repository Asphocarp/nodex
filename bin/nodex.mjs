#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function nativeCliCandidates(environment = process.env) {
  const configured = environment.NODEX_NATIVE_CLI?.trim();
  const platformArch = `${process.platform}-${process.arch}`;
  return [
    configured || null,
    join(packageRoot, "native", platformArch, "nodex"),
    join(packageRoot, "target", "release", "nodex"),
    join(packageRoot, "target", "debug", "nodex"),
    process.platform === "darwin"
      ? "/Applications/Nodex.app/Contents/Resources/bin/nodex"
      : null,
    process.platform === "darwin"
      ? join(homedir(), "Applications/Nodex.app/Contents/Resources/bin/nodex")
      : null,
  ].filter((candidate) => candidate !== null);
}

export function resolveNativeCli(environment = process.env) {
  for (const candidate of nativeCliCandidates(environment)) {
    if (!existsSync(candidate)) continue;
    const metadata = lstatSync(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
    return candidate;
  }
  return null;
}

export function runNativeCli(argv = process.argv.slice(2), environment = process.env) {
  const executable = resolveNativeCli(environment);
  if (!executable) {
    process.stderr.write(
      "Nodex native CLI is unavailable. Install Nodex.app, build `nodex-cli`, or set NODEX_NATIVE_CLI to the native executable.\n",
    );
    return 127;
  }

  const result = spawnSync(executable, argv, {
    env: environment,
    stdio: "inherit",
  });
  if (result.error) {
    process.stderr.write(`Could not launch Nodex native CLI: ${result.error.message}\n`);
    return 126;
  }
  if (result.signal) {
    process.stderr.write(`Nodex native CLI exited after signal ${result.signal}.\n`);
    return 128;
  }
  return result.status ?? 1;
}

const isDirectInvocation = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isDirectInvocation) {
  process.exitCode = runNativeCli();
}
