import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import type { ChromeBrowserAuthority } from "./ChromeBrowserFamilyRegistry";
import { resolveChromeNativeMessagingManifestPaths } from "./ChromeBrowserFamilyRegistry";

const CONFIG_FILE_NAME = "extension-host-config.json";
const NATIVE_HOST_CLOSURE_DIRECTORY = "chrome-control/native-host-v1";

export interface ChromeNativeHostRuntimePaths {
  readonly browserClientPath: string;
  readonly codexCliPath: string;
  readonly nativeHostPath: string;
  readonly nodePath: string;
  readonly nodeReplPath: string;
}

export interface ChromeNativeHostIdentity {
  readonly signingIdentifier: string;
  readonly teamId: string;
}

export interface ChromeNativeHostInstallResult {
  readonly configPath: string;
  readonly manifestPaths: readonly string[];
  readonly nativeHostPath: string;
  readonly peerIdentity: ChromeNativeHostIdentity;
}

export interface ChromeNativeHostInstallerOptions {
  readonly authority: ChromeBrowserAuthority;
  readonly channel: string;
  readonly expectedNativeHost: {
    readonly sha256: string;
    readonly signingTeamId: string;
    readonly size: number;
  };
  readonly homeDirectory: string;
  readonly runtimePaths: ChromeNativeHostRuntimePaths;
  readonly runtimeStateHome: string;
  /** Rechecks code-signing identity at both the attested source and materialized destination. */
  readonly verifyNativeHost: (nativeHostPath: string) => Promise<ChromeNativeHostIdentity>;
}

type CommandReader = (command: string, args: readonly string[]) => string;

interface ChromeNativeHostManifest {
  readonly allowed_origins: readonly string[];
  readonly description: string;
  readonly name: string;
  readonly path: string;
  readonly type: "stdio";
}

interface ChromeNativeHostConfig {
  readonly browserClientPath: string;
  readonly channel: string;
  readonly codexCliPath: string;
  readonly nodePath: string;
  readonly nodeReplPath: string;
  readonly proxyHost: "127.0.0.1";
  readonly proxyPort: 0;
  readonly schemaVersion: 1;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && Reflect.get(error, "code") === code;
}

function requireAbsoluteRegularPath(value: string, label: string): string {
  const resolved = path.resolve(value);
  if (!path.isAbsolute(value) || resolved !== value || value.includes("\0")) {
    throw new Error(`${label} must be a canonical absolute path`);
  }
  return resolved;
}

function requireContained(root: string, candidate: string, label: string): void {
  if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) return;
  throw new Error(`${label} escaped its canonical root`);
}

async function verifyRegularFile(filePath: string, executable: boolean): Promise<void> {
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new Error(`Chrome native host runtime path is not a regular file: ${filePath}`);
    }
    if (executable && (stats.mode & 0o111) === 0) {
      throw new Error(`Chrome native host is not executable: ${filePath}`);
    }
  } finally {
    await handle.close();
  }
}

async function canonicalOwnedRoot(rootPath: string, label: string): Promise<string> {
  const requested = requireAbsoluteRegularPath(rootPath, label);
  await fs.mkdir(requested, { mode: 0o700, recursive: true });
  const stats = await fs.lstat(requested);
  const currentUserId = process.getuid?.();
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular directory`);
  }
  if (currentUserId !== undefined && stats.uid !== currentUserId) {
    throw new Error(`${label} is owned by another user`);
  }
  if ((stats.mode & 0o022) !== 0) throw new Error(`${label} is writable by another user`);
  return await fs.realpath(requested);
}

async function ensureContainedDirectory(
  canonicalRoot: string,
  relativeDirectory: string,
): Promise<string> {
  const segments = relativeDirectory.split(path.sep).filter(Boolean);
  let current = canonicalRoot;
  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment.includes("\0")) {
      throw new Error("Chrome native host destination contains an unsafe path segment");
    }
    current = path.join(current, segment);
    requireContained(canonicalRoot, current, "Chrome native host destination");
    try {
      await fs.mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
    }
    const stats = await fs.lstat(current);
    const currentUserId = process.getuid?.();
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Chrome native host destination is not a regular directory: ${current}`);
    }
    if (currentUserId !== undefined && stats.uid !== currentUserId) {
      throw new Error(`Chrome native host destination is owned by another user: ${current}`);
    }
    if ((stats.mode & 0o022) !== 0) {
      throw new Error(`Chrome native host destination is writable by another user: ${current}`);
    }
    if ((await fs.realpath(current)) !== current) {
      throw new Error(`Chrome native host destination is not canonical: ${current}`);
    }
  }
  return current;
}

async function readAttestedFile(
  filePath: string,
  expected: { readonly sha256: string; readonly size: number },
): Promise<Buffer> {
  if (
    !/^[a-f0-9]{64}$/u.test(expected.sha256) ||
    !Number.isSafeInteger(expected.size) ||
    expected.size < 0
  ) {
    throw new Error("Chrome native host artifact identity is invalid");
  }
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== expected.size || (stats.mode & 0o111) === 0) {
      throw new Error("Chrome native host does not match its manifest artifact");
    }
    const bytes = await handle.readFile();
    if (createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
      throw new Error("Chrome native host failed its manifest hash check");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomically(filePath: string, bytes: Uint8Array, mode: number): Promise<void> {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(
      temporaryPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      mode,
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, mode);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeJsonAtomically(filePath: string, value: unknown, mode: number): Promise<void> {
  await writeAtomically(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"), mode);
}

async function verifyInstalledFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    const currentUserId = process.getuid?.();
    if (!stats.isFile()) {
      throw new Error(`Chrome native host install did not produce a regular file: ${filePath}`);
    }
    if (currentUserId !== undefined && stats.uid !== currentUserId) {
      throw new Error(
        `Chrome native host install produced a file owned by another user: ${filePath}`,
      );
    }
    if ((stats.mode & 0o022) !== 0) {
      throw new Error(`Chrome native host install produced a writable shared file: ${filePath}`);
    }
  } finally {
    await handle.close();
  }
}

function requireIdentity(
  identity: ChromeNativeHostIdentity,
  expectedTeamId: string,
): ChromeNativeHostIdentity {
  if (
    !identity.signingIdentifier ||
    identity.signingIdentifier.length > 256 ||
    identity.signingIdentifier.includes("\0") ||
    identity.teamId !== expectedTeamId
  ) {
    throw new Error("Chrome native host code-signing identity does not match the runtime manifest");
  }
  return identity;
}

function defaultCommandReader(command: string, args: readonly string[]): string {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${String(result.status)}`);
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

/** Returns the identity the peer-authorizer addon will observe for the selected native host. */
export function readChromeNativeHostIdentity(
  nativeHostPath: string,
  runCommand: CommandReader = defaultCommandReader,
): ChromeNativeHostIdentity {
  const output = runCommand("/usr/bin/codesign", ["-dv", "--verbose=4", nativeHostPath]);
  const signingIdentifier = /^Identifier=(.+)$/mu.exec(output)?.[1]?.trim();
  const teamId = /^TeamIdentifier=(.+)$/mu.exec(output)?.[1]?.trim();
  if (!signingIdentifier || !teamId) {
    throw new Error("Chrome native host code-signing identity is unavailable");
  }
  return { signingIdentifier, teamId };
}

/**
 * Materializes the attested native host into a Profile-owned versioned closure, then installs
 * browser manifests that point only at that immutable identity. No packaged Resource is mutated.
 */
export async function installChromeNativeHost(
  options: ChromeNativeHostInstallerOptions,
): Promise<ChromeNativeHostInstallResult> {
  const channel = options.channel.trim();
  if (!channel || channel.length > 64) throw new Error("Chrome native host channel is invalid");

  const runtimePaths = {
    browserClientPath: requireAbsoluteRegularPath(
      options.runtimePaths.browserClientPath,
      "browserClientPath",
    ),
    codexCliPath: requireAbsoluteRegularPath(options.runtimePaths.codexCliPath, "codexCliPath"),
    nativeHostPath: requireAbsoluteRegularPath(
      options.runtimePaths.nativeHostPath,
      "nativeHostPath",
    ),
    nodePath: requireAbsoluteRegularPath(options.runtimePaths.nodePath, "nodePath"),
    nodeReplPath: requireAbsoluteRegularPath(options.runtimePaths.nodeReplPath, "nodeReplPath"),
  };

  await Promise.all([
    verifyRegularFile(runtimePaths.browserClientPath, false),
    verifyRegularFile(runtimePaths.codexCliPath, true),
    verifyRegularFile(runtimePaths.nodePath, true),
    verifyRegularFile(runtimePaths.nodeReplPath, false),
  ]);
  const sourceBytes = await readAttestedFile(
    runtimePaths.nativeHostPath,
    options.expectedNativeHost,
  );
  const sourceIdentity = requireIdentity(
    await options.verifyNativeHost(runtimePaths.nativeHostPath),
    options.expectedNativeHost.signingTeamId,
  );

  const canonicalRuntimeStateHome = await canonicalOwnedRoot(
    options.runtimeStateHome,
    "Chrome runtime state home",
  );
  const closureDirectory = await ensureContainedDirectory(
    canonicalRuntimeStateHome,
    path.join(NATIVE_HOST_CLOSURE_DIRECTORY, options.expectedNativeHost.sha256),
  );
  const nativeHostPath = path.join(closureDirectory, "native-host");
  requireContained(canonicalRuntimeStateHome, nativeHostPath, "Chrome native host path");
  await writeAtomically(nativeHostPath, sourceBytes, 0o700);
  await readAttestedFile(nativeHostPath, options.expectedNativeHost);
  const peerIdentity = requireIdentity(
    await options.verifyNativeHost(nativeHostPath),
    options.expectedNativeHost.signingTeamId,
  );
  if (
    peerIdentity.signingIdentifier !== sourceIdentity.signingIdentifier ||
    peerIdentity.teamId !== sourceIdentity.teamId
  ) {
    throw new Error("Materialized Chrome native host changed its code-signing identity");
  }

  const config: ChromeNativeHostConfig = {
    browserClientPath: runtimePaths.browserClientPath,
    channel,
    codexCliPath: runtimePaths.codexCliPath,
    nodePath: runtimePaths.nodePath,
    nodeReplPath: runtimePaths.nodeReplPath,
    proxyHost: "127.0.0.1",
    proxyPort: 0,
    schemaVersion: 1,
  };
  const configPath = path.join(closureDirectory, CONFIG_FILE_NAME);
  await writeJsonAtomically(configPath, config, 0o600);

  const canonicalHome = await canonicalOwnedRoot(options.homeDirectory, "Chrome user home");
  const manifestPaths = resolveChromeNativeMessagingManifestPaths(canonicalHome, options.authority);
  const manifest: ChromeNativeHostManifest = {
    allowed_origins: options.authority.extensionIds.map(
      (extensionId) => `chrome-extension://${extensionId}/`,
    ),
    description: "Nodex browser native messaging host",
    name: options.authority.hostName,
    path: nativeHostPath,
    type: "stdio",
  };

  for (const manifestPath of manifestPaths) {
    requireContained(canonicalHome, manifestPath, "Chrome native messaging manifest");
    const relativeParent = path.relative(canonicalHome, path.dirname(manifestPath));
    await ensureContainedDirectory(canonicalHome, relativeParent);
    await writeJsonAtomically(manifestPath, manifest, 0o644);
  }
  await Promise.all([nativeHostPath, configPath, ...manifestPaths].map(verifyInstalledFile));
  await readAttestedFile(nativeHostPath, options.expectedNativeHost);
  const finalIdentity = requireIdentity(
    await options.verifyNativeHost(nativeHostPath),
    options.expectedNativeHost.signingTeamId,
  );
  if (
    finalIdentity.signingIdentifier !== peerIdentity.signingIdentifier ||
    finalIdentity.teamId !== peerIdentity.teamId
  ) {
    throw new Error("Installed Chrome native host changed its code-signing identity");
  }
  return { configPath, manifestPaths, nativeHostPath, peerIdentity };
}
