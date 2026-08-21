import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  developmentFeatureEnvironment,
  NODEX_DEVELOPMENT_FEATURES_ENV,
  resolveDevelopmentFeatureOverrides,
  type DevelopmentFeatureSlug,
} from "../src/shared/development-features";
import {
  NODEX_BROWSER_PROFILE_HELPER_EXECUTABLE_ENV,
  NODEX_CORE_EXECUTABLE_ENV,
} from "../src/shared/native-runtime-environment";
import {
  cleanupDevelopmentEnvironmentHome,
  ensureDevelopmentProfileDirectories,
  markDevelopmentEnvironmentInitialized,
  openDevelopmentEnvironmentHome,
  refreshDevelopmentEnvironmentHome,
  updateDevelopmentAgentFiles,
  type DevelopmentEnvironmentHome,
  type DevelopmentHomeManifest,
  type DevelopmentProfileSnapshotProvenance,
  type DevelopmentSeedProvenance,
} from "./development-environment-home";
import { superviseIsolatedRun, type SupervisedCommandPlan } from "./isolated-run-supervisor";
import { getScenario } from "./scenarios/registry";
import { materializeDevelopmentSeed } from "./scenarios/harness/development-seed";

export interface DevLauncherArguments {
  readonly home?: string;
  readonly seed?: string;
  readonly fromProfile?: string;
  readonly backup: string;
  readonly build: boolean;
  readonly authJson?: string;
  readonly agentConfigToml?: string;
  readonly enabledFeatures: readonly string[];
  readonly deleteHome: boolean;
  readonly help: boolean;
}

export interface DevLaunchPlan {
  readonly preparation: readonly SupervisedCommandPlan[];
  readonly application: SupervisedCommandPlan;
  readonly environment: NodeJS.ProcessEnv;
  readonly enabledFeatures: readonly DevelopmentFeatureSlug[];
  readonly mode: "hmr" | "built";
}

const USAGE = `Usage: pnpm run dev [options]

Options:
  --home <dir>               Environment root (default: runs.local/default)
  --seed <seed-id>           Initialize a new environment from the seed catalog
  --from-profile <dir>       Clone a published backup from a real Profile
  --backup <id|latest>       Backup to clone (default: latest assets-inclusive backup)
  --build                    Build optimized Rust binaries and run without HMR
  --auth-json <file>         Copy an auth.json into the environment
  --agent-config-toml <file> Copy a sanitized agent config.toml
  --enable <feature-slug>    Enable a development feature for this invocation
  --delete                   Delete the environment after a proven clean stop
  --help                     Show this help
`;

const readOptionValue = (args: readonly string[], index: number, option: string): string => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
};

export const parseDevLauncherArguments = (args: readonly string[]): DevLauncherArguments => {
  let home: string | undefined;
  let seed: string | undefined;
  let fromProfile: string | undefined;
  let backup = "latest";
  let backupWasSet = false;
  let authJson: string | undefined;
  let agentConfigToml: string | undefined;
  let build = false;
  let deleteHome = false;
  let help = false;
  const enabledFeatures: string[] = [];
  const setOnce = (option: string, current: string | undefined, value: string): string => {
    if (current !== undefined) throw new Error(`${option} may be specified only once`);
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--build") {
      build = true;
      continue;
    }
    if (argument === "--delete") {
      deleteHome = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--home") {
      const value = readOptionValue(args, index, argument);
      home = setOnce(argument, home, value);
      index += 1;
      continue;
    }
    if (argument === "--seed") {
      const value = readOptionValue(args, index, argument);
      seed = setOnce(argument, seed, value);
      index += 1;
      continue;
    }
    if (argument === "--from-profile") {
      const value = readOptionValue(args, index, argument);
      fromProfile = setOnce(argument, fromProfile, value);
      index += 1;
      continue;
    }
    if (argument === "--backup") {
      if (backupWasSet) throw new Error("--backup may be specified only once");
      backup = readOptionValue(args, index, argument);
      backupWasSet = true;
      index += 1;
      continue;
    }
    if (argument === "--auth-json") {
      const value = readOptionValue(args, index, argument);
      authJson = setOnce(argument, authJson, value);
      index += 1;
      continue;
    }
    if (argument === "--agent-config-toml") {
      const value = readOptionValue(args, index, argument);
      agentConfigToml = setOnce(argument, agentConfigToml, value);
      index += 1;
      continue;
    }
    if (argument === "--enable") {
      enabledFeatures.push(readOptionValue(args, index, argument));
      index += 1;
      continue;
    }
    throw new Error(`Unknown dev option: ${argument ?? "<missing>"}\n${USAGE}`);
  }
  if (seed && fromProfile) {
    throw new Error("--seed and --from-profile are mutually exclusive");
  }
  if (backupWasSet && !fromProfile) {
    throw new Error("--backup requires --from-profile");
  }
  return {
    ...(home === undefined ? {} : { home }),
    ...(seed === undefined ? {} : { seed }),
    ...(fromProfile === undefined ? {} : { fromProfile }),
    backup,
    build,
    ...(authJson === undefined ? {} : { authJson }),
    ...(agentConfigToml === undefined ? {} : { agentConfigToml }),
    enabledFeatures,
    deleteHome,
    help,
  };
};

const parseRemoteDebuggingPort = (environment: NodeJS.ProcessEnv): string => {
  const value = environment.NODEX_REMOTE_DEBUGGING_PORT?.trim() || "0";
  if (!/^\d+$/u.test(value)) {
    throw new Error("NODEX_REMOTE_DEBUGGING_PORT must be an integer from 0 to 65535");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("NODEX_REMOTE_DEBUGGING_PORT must be an integer from 0 to 65535");
  }
  return String(port);
};

const pnpmScript = (script: string): SupervisedCommandPlan => ({
  command: "pnpm",
  args: ["--silent", "run", script],
});

export const createDevLaunchPlan = (input: {
  readonly arguments: DevLauncherArguments;
  readonly environment: NodeJS.ProcessEnv;
  readonly home: DevelopmentEnvironmentHome;
}): DevLaunchPlan => {
  const enabledFeatures = resolveDevelopmentFeatureOverrides(input.arguments.enabledFeatures);
  const remoteDebuggingPort = parseRemoteDebuggingPort(input.environment);
  const usesProfileSnapshot =
    input.arguments.fromProfile !== undefined || input.home.manifest.profileSnapshot !== undefined;
  const environment: NodeJS.ProcessEnv = {
    ...input.environment,
    ...developmentFeatureEnvironment(enabledFeatures),
    ...(input.arguments.build
      ? {
          [NODEX_BROWSER_PROFILE_HELPER_EXECUTABLE_ENV]: path.join(
            input.home.repositoryRealpath,
            "target/release/nodex-browser-profile-helper",
          ),
          [NODEX_CORE_EXECUTABLE_ENV]: path.join(
            input.home.repositoryRealpath,
            "target/release/nodex-core",
          ),
        }
      : {}),
    NODEX_HOME: input.home.nodexHome,
    CODEX_HOME: input.home.codexHome,
    NODEX_INITIAL_PROJECTS_DIR: input.home.workspace,
    NODEX_REMOTE_DEBUGGING_PORT: remoteDebuggingPort,
    NODEX_SENTRY_ENABLED: usesProfileSnapshot ? "false" : "true",
    ...(usesProfileSnapshot
      ? {
          NODEX_SENTRY_REPLAY_ENABLED: "false",
          NODEX_SENTRY_REPLAYS_SESSION_SAMPLE_RATE: "0",
          NODEX_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE: "0",
          NODEX_TELEMETRY_ENABLED: "false",
          NODEX_TELEMETRY_AUTOCAPTURE_ENABLED: "false",
        }
      : {}),
    SENTRY_ENVIRONMENT: "development",
    SENTRY_RELEASE: "nodex-dev",
  };
  if (enabledFeatures.length === 0) {
    delete environment[NODEX_DEVELOPMENT_FEATURES_ENV];
  }
  if (input.arguments.build) {
    return {
      preparation: [
        pnpmScript("core:binaries:build:release"),
        pnpmScript("build"),
        pnpmScript("stage:codex-runtime:mac:cached"),
      ],
      application: {
        command: "pnpm",
        args: ["exec", "electron", ".", `--remote-debugging-port=${remoteDebuggingPort}`],
      },
      environment,
      enabledFeatures,
      mode: "built",
    };
  }
  return {
    preparation: [
      pnpmScript("build-resources:prepare"),
      pnpmScript("core:build:dev"),
      pnpmScript("stage:codex-runtime:mac:cached"),
      pnpmScript("sync:icons"),
    ],
    application: {
      command: "pnpm",
      args: [
        "exec",
        "electron-vite",
        "dev",
        "--logLevel",
        "warn",
        "--remoteDebuggingPort",
        remoteDebuggingPort,
      ],
    },
    environment,
    enabledFeatures,
    mode: "hmr",
  };
};

const runCommand = async (
  command: SupervisedCommandPlan,
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> => {
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(command.command, [...command.args], {
      cwd: repositoryRoot,
      env: environment,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) {
        reject(new Error(`${command.command} stopped by ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    throw new Error(`${command.command} ${command.args.join(" ")} exited with ${exitCode}`);
  }
};

export type DevelopmentSeedInitialization =
  | { readonly kind: "none" }
  | { readonly kind: "apply"; readonly seed: DevelopmentSeedProvenance }
  | { readonly kind: "reuse"; readonly seed: DevelopmentSeedProvenance };

export const resolveDevelopmentSeedInitialization = (input: {
  readonly manifest: DevelopmentHomeManifest;
  readonly requestedSeed?: DevelopmentSeedProvenance;
}): DevelopmentSeedInitialization => {
  if (!input.requestedSeed) return { kind: "none" };
  const existing = input.manifest.seed;
  if (existing) {
    if (
      existing.id !== input.requestedSeed.id ||
      existing.revision !== input.requestedSeed.revision
    ) {
      throw new Error(
        `Development home was initialized with ${existing.id}@${existing.revision}; refusing ${input.requestedSeed.id}@${input.requestedSeed.revision}`,
      );
    }
    return { kind: "reuse", seed: existing };
  }
  if (input.manifest.initializedAt) {
    throw new Error("Development home was already initialized without a seed");
  }
  return { kind: "apply", seed: input.requestedSeed };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readProfileSnapshotReceipt = async (
  nodexHome: string,
  sourceProfileHome: string,
): Promise<DevelopmentProfileSnapshotProvenance> => {
  const value: unknown = JSON.parse(
    await readFile(path.join(nodexHome, "profile-snapshot.json"), "utf8"),
  );
  if (
    !isRecord(value) ||
    value.version !== 4 ||
    typeof value.sourceProfileFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.sourceProfileFingerprint) ||
    value.backupIntegrityEvidenceVersion !== 1 ||
    typeof value.missingManagedAssetCount !== "number" ||
    !Number.isInteger(value.missingManagedAssetCount) ||
    value.missingManagedAssetCount < 0 ||
    typeof value.backupId !== "string" ||
    typeof value.backupCreatedAt !== "string" ||
    typeof value.clonedAt !== "string" ||
    typeof value.storeSchemaVersion !== "number" ||
    !Number.isInteger(value.storeSchemaVersion) ||
    typeof value.sourceStoreEpoch !== "string" ||
    value.sourceStoreEpoch.length === 0 ||
    typeof value.storeEpoch !== "string" ||
    value.storeEpoch !== value.sourceStoreEpoch ||
    typeof value.profileId !== "string" ||
    typeof value.libraryId !== "string"
  ) {
    throw new Error("Profile clone receipt is invalid or unsupported");
  }
  return {
    sourceProfileHome,
    sourceProfileFingerprint: value.sourceProfileFingerprint,
    backupIntegrityEvidenceVersion: value.backupIntegrityEvidenceVersion,
    missingManagedAssetCount: value.missingManagedAssetCount,
    backupId: value.backupId,
    backupCreatedAt: value.backupCreatedAt,
    clonedAt: value.clonedAt,
    storeSchemaVersion: value.storeSchemaVersion,
    sourceStoreEpoch: value.sourceStoreEpoch,
    storeEpoch: value.storeEpoch,
    profileId: value.profileId,
    libraryId: value.libraryId,
  };
};

const prepareProfileSnapshot = async (input: {
  readonly arguments: DevLauncherArguments;
  readonly environment: NodeJS.ProcessEnv;
  readonly home: DevelopmentEnvironmentHome;
}): Promise<void> => {
  if (!input.arguments.fromProfile) return;
  const sourceProfileHome = await realpath(path.resolve(input.arguments.fromProfile));
  const sourceProfileFingerprint = createHash("sha256").update(sourceProfileHome).digest("hex");
  const current = await refreshDevelopmentEnvironmentHome(input.home);
  const existing = current.manifest.profileSnapshot;
  if (existing) {
    const sameBackup =
      input.arguments.backup === "latest" || existing.backupId === input.arguments.backup;
    if (existing.sourceProfileHome !== sourceProfileHome || !sameBackup) {
      throw new Error(
        `Development home already contains backup ${existing.backupId} from ${existing.sourceProfileHome}`,
      );
    }
    await ensureDevelopmentProfileDirectories(current);
    process.stdout.write(`Reusing Profile snapshot ${existing.backupId} in ${current.root}\n`);
    return;
  }
  if (current.manifest.initializedAt) {
    throw new Error("Development home was already initialized without a Profile snapshot");
  }

  try {
    const published = await readProfileSnapshotReceipt(current.nodexHome, sourceProfileHome);
    const sameBackup =
      input.arguments.backup === "latest" || published.backupId === input.arguments.backup;
    if (published.sourceProfileFingerprint !== sourceProfileFingerprint || !sameBackup) {
      throw new Error("Existing Profile snapshot does not match the requested source backup");
    }
    await ensureDevelopmentProfileDirectories(current);
    await markDevelopmentEnvironmentInitialized(current, {
      kind: "profileSnapshot",
      profileSnapshot: published,
    });
    process.stdout.write(`Adopted Profile snapshot ${published.backupId} in ${current.root}\n`);
    return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const executable = path.join(
    current.repositoryRealpath,
    input.arguments.build ? "target/release/nodex" : "target/debug/nodex",
  );
  await runCommand(
    {
      command: executable,
      args: [
        "--json",
        "profile",
        "clone",
        "--from",
        sourceProfileHome,
        "--to",
        current.nodexHome,
        "--backup",
        input.arguments.backup,
      ],
    },
    current.repositoryRealpath,
    input.environment,
  );
  const profileSnapshot = await readProfileSnapshotReceipt(current.nodexHome, sourceProfileHome);
  await ensureDevelopmentProfileDirectories(current);
  await markDevelopmentEnvironmentInitialized(current, {
    kind: "profileSnapshot",
    profileSnapshot,
  });
  if (profileSnapshot.missingManagedAssetCount > 0) {
    process.stderr.write(
      `Profile snapshot preserved ${profileSnapshot.missingManagedAssetCount} missing managed asset reference(s) from the source backup.\n`,
    );
  }
  process.stdout.write(
    `Initialized ${current.root} from Profile backup ${profileSnapshot.backupId}\n`,
  );
};

const prepareEnvironment = async (input: {
  readonly arguments: DevLauncherArguments;
  readonly environment: NodeJS.ProcessEnv;
  readonly home: DevelopmentEnvironmentHome;
  readonly seedRevision?: number;
}): Promise<void> => {
  const current = await refreshDevelopmentEnvironmentHome(input.home);
  if (input.arguments.fromProfile) {
    if (!current.manifest.profileSnapshot) {
      throw new Error("Development Profile snapshot was not materialized");
    }
    await updateDevelopmentAgentFiles(current, {
      authJson: input.arguments.authJson,
      agentConfigToml: input.arguments.agentConfigToml,
    });
    return;
  }
  const requestedSeed = input.arguments.seed
    ? { id: input.arguments.seed, revision: input.seedRevision ?? -1 }
    : undefined;
  const seedInitialization = resolveDevelopmentSeedInitialization({
    manifest: current.manifest,
    requestedSeed,
  });
  await updateDevelopmentAgentFiles(current, {
    authJson: input.arguments.authJson,
    agentConfigToml: input.arguments.agentConfigToml,
  });
  if (seedInitialization.kind === "none") {
    if (!current.manifest.initializedAt) {
      await markDevelopmentEnvironmentInitialized(current);
    }
    return;
  }
  if (seedInitialization.kind === "reuse") {
    process.stdout.write(
      `Reusing seed ${seedInitialization.seed.id}@${seedInitialization.seed.revision} in ${current.root}\n`,
    );
    return;
  }
  const manifest = await materializeDevelopmentSeed({
    environment: input.environment,
    scenarioId: seedInitialization.seed.id,
    nodexHome: current.nodexHome,
    workspace: current.workspace,
  });
  if (manifest.scenarioRevision !== seedInitialization.seed.revision) {
    throw new Error(
      `Seed revision changed during initialization: expected ${seedInitialization.seed.revision}, received ${manifest.scenarioRevision}`,
    );
  }
  await markDevelopmentEnvironmentInitialized(current, {
    kind: "seed",
    seed: seedInitialization.seed,
  });
  process.stdout.write(
    `Initialized ${current.root} with seed ${seedInitialization.seed.id}@${seedInitialization.seed.revision}\n`,
  );
};

export const runDevLauncher = async (input: {
  readonly args: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly repositoryRoot: string;
}): Promise<number> => {
  const arguments_ = parseDevLauncherArguments(input.args);
  if (arguments_.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const environment = input.environment ?? process.env;
  const recipe = arguments_.seed ? getScenario(arguments_.seed) : null;
  const home = await openDevelopmentEnvironmentHome({
    repositoryRoot: input.repositoryRoot,
    home: arguments_.home,
    initializeProfileHome: arguments_.fromProfile === undefined,
  });
  let plan: DevLaunchPlan;
  try {
    plan = createDevLaunchPlan({ arguments: arguments_, environment, home });
  } catch (error) {
    if (home.wasCreated) await cleanupDevelopmentEnvironmentHome(home);
    throw error;
  }
  process.stdout.write(`Nodex ${plan.mode} environment: ${home.root}\n`);
  if (plan.enabledFeatures.length > 0) {
    process.stdout.write(`Enabled features: ${plan.enabledFeatures.join(", ")}\n`);
  }

  let preparationError: unknown;
  try {
    for (const command of plan.preparation) {
      await runCommand(command, home.repositoryRealpath, plan.environment);
    }
    await prepareProfileSnapshot({
      arguments: arguments_,
      environment: plan.environment,
      home,
    });
  } catch (error) {
    preparationError = error;
  }
  if (preparationError) {
    if (home.wasCreated) {
      await cleanupDevelopmentEnvironmentHome(home);
    }
    throw preparationError;
  }

  let environmentPreparationFailed = false;
  const result = await superviseIsolatedRun({
    command: plan.application,
    environment: plan.environment,
    nodexHome: home.nodexHome,
    repositoryRoot: home.repositoryRealpath,
    prepare: async () => {
      try {
        await prepareEnvironment({
          arguments: arguments_,
          environment: plan.environment,
          home,
          seedRevision: recipe?.revision,
        });
      } catch (error) {
        environmentPreparationFailed = true;
        throw error;
      }
    },
  });

  const shouldDelete = arguments_.deleteHome || (home.wasCreated && environmentPreparationFailed);
  if (shouldDelete) {
    if (!result.safeToDeleteRunRoot) {
      process.stderr.write(
        `Preserved unsafe development home ${home.root}; clean shutdown was not proven.\n`,
      );
      return result.childExitCode === 0 ? 1 : result.childExitCode;
    }
    const cleanup = await cleanupDevelopmentEnvironmentHome(home);
    if (cleanup.status === "unsafe") {
      process.stderr.write(`Preserved unsafe development home ${home.root}: ${cleanup.reason}\n`);
      return result.childExitCode === 0 ? 1 : result.childExitCode;
    }
    process.stdout.write(`Deleted development home ${home.root}\n`);
  }
  return result.childExitCode;
};

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
  void runDevLauncher({
    args: process.argv.slice(2),
    repositoryRoot,
  })
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
