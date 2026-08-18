import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  developmentFeatureEnvironment,
  NODEX_DEVELOPMENT_FEATURES_ENV,
  resolveDevelopmentFeatureOverrides,
  type DevelopmentFeatureSlug,
} from "../src/shared/development-features";
import {
  cleanupDevelopmentEnvironmentHome,
  markDevelopmentEnvironmentInitialized,
  openDevelopmentEnvironmentHome,
  refreshDevelopmentEnvironmentHome,
  updateDevelopmentAgentFiles,
  type DevelopmentEnvironmentHome,
  type DevelopmentHomeManifest,
  type DevelopmentSeedProvenance,
} from "./development-environment-home";
import {
  superviseIsolatedRun,
  type SupervisedCommandPlan,
} from "./isolated-run-supervisor";
import { getScenario } from "./scenarios/registry";
import { materializeDevelopmentSeed } from
  "./scenarios/harness/development-seed";

export interface DevLauncherArguments {
  readonly home?: string;
  readonly seed?: string;
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
  --build                    Build and run without HMR
  --auth-json <file>         Copy an auth.json into the environment
  --agent-config-toml <file> Copy a sanitized agent config.toml
  --enable <feature-slug>    Enable a development feature for this invocation
  --delete                   Delete the environment after a proven clean stop
  --help                     Show this help
`;

const readOptionValue = (
  args: readonly string[],
  index: number,
  option: string,
): string => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
};

export const parseDevLauncherArguments = (
  args: readonly string[],
): DevLauncherArguments => {
  let home: string | undefined;
  let seed: string | undefined;
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
  return {
    ...(home === undefined ? {} : { home }),
    ...(seed === undefined ? {} : { seed }),
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
  const enabledFeatures = resolveDevelopmentFeatureOverrides(
    input.arguments.enabledFeatures,
  );
  const remoteDebuggingPort = parseRemoteDebuggingPort(input.environment);
  const environment: NodeJS.ProcessEnv = {
    ...input.environment,
    ...developmentFeatureEnvironment(enabledFeatures),
    NODEX_HOME: input.home.nodexHome,
    CODEX_HOME: input.home.codexHome,
    NODEX_INITIAL_PROJECTS_DIR: input.home.workspace,
    NODEX_REMOTE_DEBUGGING_PORT: remoteDebuggingPort,
    NODEX_SENTRY_ENABLED: "true",
    SENTRY_ENVIRONMENT: "development",
    SENTRY_RELEASE: "nodex-dev",
  };
  if (enabledFeatures.length === 0) {
    delete environment[NODEX_DEVELOPMENT_FEATURES_ENV];
  }
  if (input.arguments.build) {
    return {
      preparation: [
        pnpmScript("core:build:dev"),
        pnpmScript("build"),
        pnpmScript("stage:codex-runtime:mac:cached"),
      ],
      application: {
        command: "pnpm",
        args: [
          "exec",
          "electron",
          ".",
          `--remote-debugging-port=${remoteDebuggingPort}`,
        ],
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
      existing.id !== input.requestedSeed.id
      || existing.revision !== input.requestedSeed.revision
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

const prepareEnvironment = async (input: {
  readonly arguments: DevLauncherArguments;
  readonly home: DevelopmentEnvironmentHome;
  readonly seedRevision?: number;
}): Promise<void> => {
  const current = await refreshDevelopmentEnvironmentHome(input.home);
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
    scenarioId: seedInitialization.seed.id,
    nodexHome: current.nodexHome,
    workspace: current.workspace,
  });
  if (manifest.scenarioRevision !== seedInitialization.seed.revision) {
    throw new Error(
      `Seed revision changed during initialization: expected ${seedInitialization.seed.revision}, received ${manifest.scenarioRevision}`,
    );
  }
  await markDevelopmentEnvironmentInitialized(current, seedInitialization.seed);
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
  });
  let plan: DevLaunchPlan;
  try {
    plan = createDevLaunchPlan({ arguments: arguments_, environment, home });
  } catch (error) {
    if (home.wasCreated) await cleanupDevelopmentEnvironmentHome(home);
    throw error;
  }
  process.stdout.write(
    `Nodex ${plan.mode} environment: ${home.root}\n`,
  );
  if (plan.enabledFeatures.length > 0) {
    process.stdout.write(`Enabled features: ${plan.enabledFeatures.join(", ")}\n`);
  }

  let preparationError: unknown;
  try {
    for (const command of plan.preparation) {
      await runCommand(command, home.repositoryRealpath, plan.environment);
    }
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
          home,
          seedRevision: recipe?.revision,
        });
      } catch (error) {
        environmentPreparationFailed = true;
        throw error;
      }
    },
  });

  const shouldDelete = arguments_.deleteHome
    || (home.wasCreated && environmentPreparationFailed);
  if (shouldDelete) {
    if (!result.safeToDeleteRunRoot) {
      process.stderr.write(
        `Preserved unsafe development home ${home.root}; clean shutdown was not proven.\n`,
      );
      return result.childExitCode === 0 ? 1 : result.childExitCode;
    }
    const cleanup = await cleanupDevelopmentEnvironmentHome(home);
    if (cleanup.status === "unsafe") {
      process.stderr.write(
        `Preserved unsafe development home ${home.root}: ${cleanup.reason}\n`,
      );
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
  }).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error: unknown) => {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
