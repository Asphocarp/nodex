import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseBundledCodexRuntimeMetadata,
  type BundledCodexRuntimeMetadata,
} from "../src/shared/codex-runtime-metadata";
import { resolveCodexRuntime } from "../src/main/codex/codex-runtime";

const OPENAI_TEAM_IDENTIFIER = "2DC432GLL2";

function readOption(argv: string[], option: string): string | null {
  const index = argv.indexOf(option);
  if (index < 0) return null;
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function verifyMacosSignature(artifactPath: string): void {
  const verification = spawnSync("codesign", ["--verify", "--strict", "--verbose=2", artifactPath], {
    encoding: "utf8",
  });
  if (verification.error) {
    throw new Error(`Could not run codesign for ${artifactPath}: ${verification.error.message}`);
  }
  if (verification.status !== 0) {
    throw new Error(
      `Invalid code signature for ${artifactPath}: ${(verification.stderr || verification.stdout).trim()}`,
    );
  }

  const result = spawnSync("codesign", ["-dv", "--verbose=4", artifactPath], {
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`Could not inspect code signature for ${artifactPath}: ${result.error.message}`);
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`Could not inspect code signature for ${artifactPath}: ${output.trim()}`);
  }
  const teamIdentifier = /^TeamIdentifier=(.+)$/mu.exec(output)?.[1]?.trim();
  if (teamIdentifier !== OPENAI_TEAM_IDENTIFIER) {
    throw new Error(
      `Expected ${artifactPath} to retain the OpenAI signature (${OPENAI_TEAM_IDENTIFIER}); found ${teamIdentifier ?? "no team identifier"}`,
    );
  }
}

function readRuntimeMetadata(metadataPath: string): BundledCodexRuntimeMetadata {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch {
    throw new Error(`Invalid bundled Codex runtime metadata at ${metadataPath}`);
  }
  const metadata = parseBundledCodexRuntimeMetadata(value);
  if (!metadata) {
    throw new Error(`Invalid bundled Codex runtime metadata at ${metadataPath}`);
  }
  return metadata;
}

export function verifyCodexRuntime(input: {
  resourcesPath: string;
  verifyMacosSignatures: boolean;
}): void {
  const runtime = resolveCodexRuntime({
    isPackaged: true,
    resourcesPath: input.resourcesPath,
  });
  const versionResult = spawnSync(runtime.binaryPath, ["--version"], { encoding: "utf8" });
  if (versionResult.error) {
    throw new Error(`Could not execute bundled Codex: ${versionResult.error.message}`);
  }
  if (versionResult.status !== 0) {
    throw new Error(`Bundled Codex failed to report its version: ${versionResult.stderr.trim()}`);
  }
  if (!runtime.version || !versionResult.stdout.includes(runtime.version)) {
    throw new Error(
      `Bundled Codex version ${versionResult.stdout.trim()} did not match runtime metadata ${runtime.version ?? "<missing>"}`,
    );
  }

  if (input.verifyMacosSignatures) {
    if (!runtime.metadataPath) {
      throw new Error("Bundled Codex runtime metadata path is unavailable");
    }
    const metadata = readRuntimeMetadata(runtime.metadataPath);
    for (const artifact of metadata.artifacts) {
      if (!artifact.executable) continue;
      verifyMacosSignature(join(input.resourcesPath, "bin", ...artifact.path.split("/")));
    }
  }

  process.stdout.write(`Verified Codex runtime ${runtime.version}\n`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const resourcesPath = readOption(argv, "--resources-path");
  if (!resourcesPath) {
    throw new Error("Usage: verify-codex-runtime.ts --resources-path <Electron Resources> [--verify-macos-signatures]");
  }
  verifyCodexRuntime({
    resourcesPath: resolve(resourcesPath),
    verifyMacosSignatures: argv.includes("--verify-macos-signatures"),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
