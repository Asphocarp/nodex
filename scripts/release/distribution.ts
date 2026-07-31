import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { verifyPackagedBuildProvenance } from "../package-provenance.mjs";
import { verifyCodexRuntime } from "../verify-codex-runtime";
import { verifyPackagedNativeRuntime } from "../verify-native-runtime";
import { recordArchitectureBuild, type ArchitectureBuildManifest, type MacArchitecture } from "./bundle";
import { normalizeStableVersion } from "./model";
import { inspectReleaseSource } from "./source";

const run = (
  cwd: string,
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): string => execFileSync(command, [...args], {
  cwd,
  encoding: "utf8",
  env: environment,
  stdio: ["ignore", "pipe", "inherit"],
}).trim();

const runTask = (cwd: string, command: string, args: readonly string[]): void => {
  execFileSync(command, [...args], {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
};

const requireNativeMac = (architecture: MacArchitecture): void => {
  if (process.platform !== "darwin" || process.arch !== architecture) {
    throw new Error(`Release distribution must run natively on darwin ${architecture}.`);
  }
};

const assertSourceIdentity = (cwd: string, sourceSha: string, version: string): void => {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) throw new Error("Source SHA must be a full commit SHA.");
  if (run(cwd, "git", ["rev-parse", "HEAD"]) !== sourceSha) {
    throw new Error("Release distribution checkout does not match the requested source SHA.");
  }
  if (run(cwd, "git", ["status", "--porcelain", "--untracked-files=normal"])) {
    throw new Error("Release distribution requires a clean source checkout.");
  }
  if (inspectReleaseSource(cwd).packageVersion !== version) {
    throw new Error("Release distribution source version does not match the requested version.");
  }
};

const appAtRoot = (root: string): string => {
  const appNames = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.endsWith(".app"))
    .map(({ name }) => name);
  if (appNames.length !== 1) {
    throw new Error(`Expected exactly one app bundle in ${root}; found ${appNames.length}.`);
  }
  return join(root, appNames[0]);
};

interface VerifiedAppIdentity {
  readonly bundleId: string;
  readonly provenanceId: string;
  readonly teamIdentifier: string;
  readonly version: string;
}

const readAppIdentity = (appPath: string): Omit<VerifiedAppIdentity, "provenanceId"> => {
  const infoPlist = join(appPath, "Contents/Info.plist");
  const readPlist = (key: string): string => execFileSync(
    "/usr/bin/plutil",
    ["-extract", key, "raw", "-o", "-", infoPlist],
    { encoding: "utf8" },
  ).trim();
  const signature = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], {
    encoding: "utf8",
  });
  if (signature.error || signature.status !== 0) {
    throw new Error(`Unable to inspect app signing identity: ${signature.error?.message ?? signature.stderr}`);
  }
  const teamIdentifier = /^TeamIdentifier=(.+)$/mu.exec(`${signature.stdout}\n${signature.stderr}`)?.[1]?.trim();
  if (!teamIdentifier || teamIdentifier === "not set") {
    throw new Error("Packaged app does not have a Developer ID team identifier.");
  }
  return {
    bundleId: readPlist("CFBundleIdentifier"),
    teamIdentifier,
    version: readPlist("CFBundleShortVersionString"),
  };
};

const verifyApp = async (options: {
  readonly appPath: string;
  readonly architecture: MacArchitecture;
  readonly launchApp: boolean;
  readonly preparedManifestPath: string;
  readonly version: string;
}): Promise<VerifiedAppIdentity> => {
  const provenance = verifyPackagedBuildProvenance(options.appPath, {
    expectedArch: options.architecture,
    expectedPreparedManifestPath: options.preparedManifestPath,
  });
  if (provenance.product.version !== options.version) {
    throw new Error("Packaged provenance product version does not match the release identity.");
  }
  verifyCodexRuntime({
    requireBrowserRuntime: true,
    resourcesPath: join(options.appPath, "Contents/Resources"),
    verifyMacosSignatures: true,
  });
  await verifyPackagedNativeRuntime({
    appPath: options.appPath,
    expectedVersion: options.version,
    launchApp: options.launchApp,
    requireDeveloperId: true,
    targetArch: options.architecture,
    verifyNotarization: true,
    verifySignatures: true,
  });
  return { ...readAppIdentity(options.appPath), provenanceId: provenance.provenanceId };
};

export async function buildMacDistribution(options: {
  readonly architecture: MacArchitecture;
  readonly cwd: string;
  readonly outputDirectory: string;
  readonly sourceSha: string;
  readonly version: string;
}): Promise<ArchitectureBuildManifest> {
  const cwd = resolve(options.cwd);
  const sourceSha = options.sourceSha.trim().toLowerCase();
  const version = normalizeStableVersion(options.version);
  requireNativeMac(options.architecture);
  assertSourceIdentity(cwd, sourceSha, version);

  const prerequisiteScripts = [
    "legacy-profile-migrator:verify-reproducible",
    "third-party-notices:verify",
    "codex:schemas:verify",
    "codex:schemas:compat",
    "test:agent-runtime-conformance",
    "test:browser-runtime-conformance",
  ] as const;
  for (const script of prerequisiteScripts) runTask(cwd, "pnpm", ["run", script]);
  runTask(cwd, "pnpm", ["run", `package:mac:${options.architecture}`]);
  assertSourceIdentity(cwd, sourceSha, version);

  const distDirectory = join(cwd, "dist");
  const zipPath = join(distDirectory, `Nodex-${version}-${options.architecture}.zip`);
  const dmgPath = join(distDirectory, `Nodex-${version}-${options.architecture}.dmg`);
  const preparedManifestPath = join(cwd, ".generated/prepared-electron-build.json");
  const temporaryRoot = mkdtempSync(join(tmpdir(), `nodex-distribution-${options.architecture}-`));
  const zipRoot = join(temporaryRoot, "zip");
  const mountRoot = join(temporaryRoot, "dmg");
  let mounted = false;
  try {
    run(cwd, "/usr/bin/ditto", ["-x", "-k", zipPath, zipRoot]);
    const zipAppPath = appAtRoot(zipRoot);
    const zipProvenance = await verifyApp({
      appPath: zipAppPath,
      architecture: options.architecture,
      launchApp: true,
      preparedManifestPath,
      version,
    });

    mkdirSync(mountRoot);
    run(cwd, "/usr/bin/hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-mountpoint",
      mountRoot,
      dmgPath,
    ]);
    mounted = true;
    const dmgAppPath = appAtRoot(mountRoot);
    const dmgProvenance = await verifyApp({
      appPath: dmgAppPath,
      architecture: options.architecture,
      launchApp: false,
      preparedManifestPath,
      version,
    });
    if (JSON.stringify(zipProvenance) !== JSON.stringify(dmgProvenance)) {
      throw new Error("ZIP and DMG apps do not share one version, bundle, team, and package provenance identity.");
    }

    return recordArchitectureBuild({
      appPath: zipAppPath,
      architecture: options.architecture,
      cwd,
      distDirectory,
      outputDirectory: options.outputDirectory,
      sourceSha,
      version,
    });
  } finally {
    if (mounted) {
      try {
        run(cwd, "/usr/bin/hdiutil", ["detach", mountRoot]);
      } catch (error) {
        process.stderr.write(`Unable to detach ${mountRoot}: ${String(error)}\n`);
      }
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
