import { spawnSync } from "node:child_process";
import fs from "node:fs";
import type {
  BrowserRuntimePlatformArtifactVerifier,
} from "./browser-runtime-bundle";

type CommandReader = (command: string, args: string[]) => string;

function defaultCommandReader(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${String(result.status)}`);
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

function isMachO(filePath: string): boolean {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(4);
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) return false;
    const magic = header.readUInt32BE(0);
    return magic === 0xfeedface
      || magic === 0xfeedfacf
      || magic === 0xcefaedfe
      || magic === 0xcffaedfe
      || magic === 0xcafebabe
      || magic === 0xbebafeca
      || magic === 0xcafebabf
      || magic === 0xbfbafeca;
  } finally {
    fs.closeSync(descriptor);
  }
}

function readTeamIdentifier(
  filePath: string,
  run: CommandReader,
): string | null {
  try {
    const output = run("/usr/bin/codesign", ["-dv", "--verbose=4", filePath]);
    return /^TeamIdentifier=(.+)$/mu.exec(output)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export function createBrowserRuntimePlatformArtifactVerifier(
  options: {
    platform?: NodeJS.Platform;
    runCommand?: CommandReader;
  } = {},
): BrowserRuntimePlatformArtifactVerifier {
  const platform = options.platform ?? process.platform;
  const run = options.runCommand ?? defaultCommandReader;
  return ({ artifact, artifactPath, manifest }) => {
    if (platform !== manifest.targetPlatform) {
      return `runtime target ${manifest.targetPlatform} cannot be verified on ${platform}`;
    }
    if (platform !== "darwin") {
      return `Browser runtime platform verification is unavailable on ${platform}`;
    }
    if (!isMachO(artifactPath)) {
      return artifact.architecture === "any"
        ? null
        : "architecture-specific artifact is not Mach-O";
    }

    let architectures: string[];
    try {
      architectures = run("/usr/bin/lipo", ["-archs", artifactPath])
        .split(/\s+/u)
        .filter(Boolean);
    } catch {
      return "could not inspect Mach-O architecture";
    }
    const expectedArch = manifest.targetArch === "x64" ? "x86_64" : "arm64";
    if (!architectures.includes(expectedArch)) {
      return `Mach-O artifact does not contain ${expectedArch}`;
    }
    try {
      run("/usr/bin/codesign", ["--verify", "--strict", artifactPath]);
    } catch {
      return "Mach-O code signature is invalid";
    }
    if (artifact.path !== manifest.entrypoints.peerAuthorization) return null;

    const teamIdentifier = readTeamIdentifier(artifactPath, run);
    if (teamIdentifier !== manifest.peerAuthorization.signingTeamId) {
      return "peer authorization signing Team ID does not match the manifest";
    }
    return null;
  };
}
