import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import { readIsolatedRunLeaseOwner } from
  "../src/main/core-client/isolated-run-ownership";
import { copyIsolatedCodexConfig } from "./copy-isolated-codex-config";

export const DEVELOPMENT_HOME_MANIFEST_FILE = "dev-home.json" as const;
const DEVELOPMENT_HOME_MANIFEST_VERSION = 1 as const;
const MACOS_UNIX_SOCKET_PATH_MAX_BYTES = 103;

export interface DevelopmentSeedProvenance {
  readonly id: string;
  readonly revision: number;
}

export interface DevelopmentHomeManifest {
  readonly version: typeof DEVELOPMENT_HOME_MANIFEST_VERSION;
  readonly environmentId: string;
  readonly repositoryRealpath: string;
  readonly createdAt: string;
  readonly initializedAt?: string;
  readonly seed?: DevelopmentSeedProvenance;
}

export interface DevelopmentEnvironmentHome {
  readonly root: string;
  readonly nodexHome: string;
  readonly codexHome: string;
  readonly workspace: string;
  readonly artifacts: string;
  readonly manifestPath: string;
  readonly repositoryRealpath: string;
  readonly wasCreated: boolean;
  readonly manifest: DevelopmentHomeManifest;
}

export interface DevelopmentHomeCleanupResult {
  readonly status: "deleted" | "already_missing" | "unsafe";
  readonly reason?: string;
}

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseSeed = (value: unknown): DevelopmentSeedProvenance | undefined => {
  if (value === undefined) return undefined;
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || value.id.length === 0
    || typeof value.revision !== "number"
    || !Number.isInteger(value.revision)
  ) {
    throw new Error("Development home seed provenance is invalid");
  }
  return { id: value.id, revision: value.revision };
};

export const parseDevelopmentHomeManifest = (
  value: unknown,
): DevelopmentHomeManifest => {
  if (
    !isRecord(value)
    || value.version !== DEVELOPMENT_HOME_MANIFEST_VERSION
    || typeof value.environmentId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(value.environmentId)
    || typeof value.repositoryRealpath !== "string"
    || !path.isAbsolute(value.repositoryRealpath)
    || typeof value.createdAt !== "string"
    || (value.initializedAt !== undefined && typeof value.initializedAt !== "string")
  ) {
    throw new Error("Development home manifest is invalid or unsupported");
  }
  return {
    version: DEVELOPMENT_HOME_MANIFEST_VERSION,
    environmentId: value.environmentId,
    repositoryRealpath: value.repositoryRealpath,
    createdAt: value.createdAt,
    ...(value.initializedAt === undefined
      ? {}
      : { initializedAt: value.initializedAt }),
    ...(value.seed === undefined ? {} : { seed: parseSeed(value.seed) }),
  };
};

const readManifest = async (manifestPath: string): Promise<DevelopmentHomeManifest> =>
  parseDevelopmentHomeManifest(JSON.parse(await readFile(manifestPath, "utf8")));

const writeNewManifest = async (
  manifestPath: string,
  manifest: DevelopmentHomeManifest,
): Promise<void> => {
  const handle = await open(manifestPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
};

const replaceManifest = async (
  manifestPath: string,
  manifest: DevelopmentHomeManifest,
): Promise<void> => {
  const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, manifestPath);
    await chmod(manifestPath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

const descriptor = (
  root: string,
  repositoryRealpath: string,
  manifest: DevelopmentHomeManifest,
  wasCreated: boolean,
): DevelopmentEnvironmentHome => ({
  root,
  nodexHome: path.join(root, ".nodex"),
  codexHome: path.join(root, ".nodex/agent"),
  workspace: path.join(root, "workspace"),
  artifacts: path.join(root, "artifacts"),
  manifestPath: path.join(root, DEVELOPMENT_HOME_MANIFEST_FILE),
  repositoryRealpath,
  wasCreated,
  manifest,
});

const assertSocketPathBudget = (nodexHome: string): void => {
  if (process.platform !== "darwin") return;
  const socketPath = path.join(nodexHome, "run/core/core.sock");
  const bytes = Buffer.byteLength(socketPath, "utf8");
  if (bytes <= MACOS_UNIX_SOCKET_PATH_MAX_BYTES) return;
  throw new Error(
    `Core socket path is ${bytes} bytes, exceeding the macOS limit of ${MACOS_UNIX_SOCKET_PATH_MAX_BYTES}. Choose a shorter --home path.`,
  );
};

const assertRealDirectory = async (root: string): Promise<void> => {
  const stats = await lstat(root);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Development home must be a real directory: ${root}`);
  }
};

export const resolveDevelopmentHomeRoot = (
  repositoryRoot: string,
  configuredHome?: string,
): string => path.resolve(
  repositoryRoot,
  configuredHome ?? "runs.local/default",
);

export const openDevelopmentEnvironmentHome = async (input: {
  readonly repositoryRoot: string;
  readonly home?: string;
}): Promise<DevelopmentEnvironmentHome> => {
  const repositoryRealpath = await realpath(input.repositoryRoot);
  const requestedRoot = resolveDevelopmentHomeRoot(repositoryRealpath, input.home);
  let rootExisted = true;
  try {
    await assertRealDirectory(requestedRoot);
  } catch (error) {
    if (!isMissing(error)) throw error;
    rootExisted = false;
    await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
    await assertRealDirectory(requestedRoot);
  }
  const root = await realpath(requestedRoot);
  try {
    assertSocketPathBudget(path.join(root, ".nodex"));
  } catch (error) {
    if (!rootExisted) await rm(root, { force: true, recursive: true });
    throw error;
  }

  const manifestPath = path.join(root, DEVELOPMENT_HOME_MANIFEST_FILE);
  let manifest: DevelopmentHomeManifest;
  let wasCreated = false;
  try {
    manifest = await readManifest(manifestPath);
  } catch (error) {
    if (!isMissing(error)) throw error;
    const entries = await readdir(root);
    if (entries.length > 0) {
      throw new Error(
        `Development home exists without ${DEVELOPMENT_HOME_MANIFEST_FILE}: ${root}`,
      );
    }
    manifest = {
      version: DEVELOPMENT_HOME_MANIFEST_VERSION,
      environmentId: randomUUID(),
      repositoryRealpath,
      createdAt: new Date().toISOString(),
    };
    try {
      await writeNewManifest(manifestPath, manifest);
      wasCreated = true;
    } catch (writeError) {
      if (!(writeError instanceof Error && "code" in writeError && writeError.code === "EEXIST")) {
        if (!rootExisted) await rm(root, { force: true, recursive: true });
        throw writeError;
      }
      manifest = await readManifest(manifestPath);
    }
  }
  if (manifest.repositoryRealpath !== repositoryRealpath) {
    throw new Error("Development home belongs to another repository");
  }
  const home = descriptor(root, repositoryRealpath, manifest, wasCreated);
  try {
    await Promise.all([
      mkdir(home.nodexHome, { recursive: true, mode: 0o700 }),
      mkdir(home.codexHome, { recursive: true, mode: 0o700 }),
      mkdir(home.workspace, { recursive: true, mode: 0o700 }),
      mkdir(home.artifacts, { recursive: true, mode: 0o700 }),
    ]);
    return home;
  } catch (error) {
    if (wasCreated) await rm(root, { force: true, recursive: true });
    throw error;
  }
};

export const refreshDevelopmentEnvironmentHome = async (
  home: DevelopmentEnvironmentHome,
): Promise<DevelopmentEnvironmentHome> => {
  await assertRealDirectory(home.root);
  const manifest = await readManifest(home.manifestPath);
  if (
    manifest.environmentId !== home.manifest.environmentId
    || manifest.repositoryRealpath !== home.repositoryRealpath
  ) {
    throw new Error("Development home ownership changed");
  }
  return { ...home, manifest };
};

export const markDevelopmentEnvironmentInitialized = async (
  home: DevelopmentEnvironmentHome,
  seed?: DevelopmentSeedProvenance,
): Promise<DevelopmentEnvironmentHome> => {
  const current = await refreshDevelopmentEnvironmentHome(home);
  if (
    seed
    && current.manifest.seed
    && (
      current.manifest.seed.id !== seed.id
      || current.manifest.seed.revision !== seed.revision
    )
  ) {
    throw new Error("Development home seed provenance is immutable");
  }
  if (seed && current.manifest.initializedAt && !current.manifest.seed) {
    throw new Error("Initialized development home cannot gain seed provenance");
  }
  const manifest: DevelopmentHomeManifest = {
    ...current.manifest,
    initializedAt: current.manifest.initializedAt ?? new Date().toISOString(),
    ...(seed === undefined ? {} : { seed }),
  };
  await replaceManifest(home.manifestPath, manifest);
  return { ...home, manifest };
};

const requireRegularSource = async (source: string, label: string): Promise<string> => {
  const resolved = path.resolve(source);
  const stats = await lstat(resolved);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular file: ${resolved}`);
  }
  return resolved;
};

const installPrivateFile = async (
  destination: string,
  write: (temporaryPath: string) => Promise<void>,
): Promise<void> => {
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  try {
    await write(temporaryPath);
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, destination);
    await chmod(destination, 0o600);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

export const updateDevelopmentAgentFiles = async (
  home: DevelopmentEnvironmentHome,
  input: { readonly authJson?: string; readonly agentConfigToml?: string },
): Promise<void> => {
  if (input.authJson) {
    const source = await requireRegularSource(input.authJson, "--auth-json");
    await installPrivateFile(path.join(home.codexHome, "auth.json"), async (target) => {
      await copyFile(source, target);
    });
  }
  if (input.agentConfigToml) {
    const source = await requireRegularSource(
      input.agentConfigToml,
      "--agent-config-toml",
    );
    await installPrivateFile(path.join(home.codexHome, "config.toml"), async (target) => {
      await copyIsolatedCodexConfig(source, target);
    });
  }
};

const runtimeEvidencePaths = (home: DevelopmentEnvironmentHome): readonly string[] => [
  path.join(home.nodexHome, "run/isolated-supervisor.lock"),
  path.join(home.nodexHome, "run/core/core.json"),
  path.join(home.nodexHome, "run/core/core.auth"),
  path.join(home.nodexHome, "run/core/core.sock"),
];

export const cleanupDevelopmentEnvironmentHome = async (
  home: DevelopmentEnvironmentHome,
): Promise<DevelopmentHomeCleanupResult> => {
  try {
    await assertRealDirectory(home.root);
  } catch (error) {
    if (isMissing(error)) return { status: "already_missing" };
    return { status: "unsafe", reason: error instanceof Error ? error.message : String(error) };
  }
  try {
    const manifest = await readManifest(home.manifestPath);
    if (
      manifest.environmentId !== home.manifest.environmentId
      || manifest.repositoryRealpath !== home.repositoryRealpath
    ) {
      return { status: "unsafe", reason: "Development home ownership manifest does not match" };
    }
    if (readIsolatedRunLeaseOwner(home.nodexHome)) {
      return { status: "unsafe", reason: "Development home still has a launcher lease" };
    }
    for (const evidencePath of runtimeEvidencePaths(home)) {
      try {
        await lstat(evidencePath);
        return { status: "unsafe", reason: `Runtime evidence remains: ${evidencePath}` };
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    await rm(home.root, { recursive: true });
    return { status: "deleted" };
  } catch (error) {
    return { status: "unsafe", reason: error instanceof Error ? error.message : String(error) };
  }
};
