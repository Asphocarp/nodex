import path from "node:path";
import type { ThreadStartParams } from "@nodex/codex-app-server-protocol/v2/ThreadStartParams";
import type {
  BrowserRuntimeAvailability,
  BrowserRuntimeUnavailableReason,
  VerifiedBrowserRuntimeBundle,
} from "./browser-runtime-bundle";
import type { BrowserRuntimeBackend } from "../../shared/browser-runtime-metadata";
import { resolveAvailableBrowserUseBackends } from "./browser-use-backends";

const BROWSER_USE_IN_APP_INSTRUCTIONS =
  "Control the in-app browser in conjunction with the Browser Plugin.";

type BrowserUseThreadConfig = NonNullable<ThreadStartParams["config"]>;

export type BrowserUseThreadConfigResult =
  | {
    message: string;
    reason: BrowserRuntimeUnavailableReason;
    status: "unavailable";
  }
  | {
    config: BrowserUseThreadConfig;
    status: "available";
  };

type BrowserUseThreadConfigBuilderOptions = {
  availableBackends?: () => readonly BrowserRuntimeBackend[];
  browserRuntime: BrowserRuntimeAvailability;
  runtimeStateHome: string;
};

function buildAvailableConfig(
  bundle: VerifiedBrowserRuntimeBundle,
  runtimeStateHome: string,
  availableBackends: readonly BrowserRuntimeBackend[],
): BrowserUseThreadConfig {
  const availableBackendsValue = availableBackends.join(",");
  const trustedClientHashes = bundle.browserPluginClientSha256;
  const trustedCodePaths = bundle.browserPluginRoot;
  const env: Record<string, string> = {
    BROWSER_USE_AVAILABLE_BACKENDS: availableBackendsValue,
    BROWSER_USE_CODEX_APP_BUILD_FLAVOR: bundle.manifest.buildFlavor,
    BROWSER_USE_CODEX_APP_VERSION: bundle.manifest.desktopBuild,
    CODEX_CLI_PATH: bundle.paths.codexCli,
    CODEX_HOME: runtimeStateHome,
    NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS: "1000",
    NODE_REPL_NODE_MODULE_DIRS: bundle.nodeModuleDirs.join(path.delimiter),
    NODE_REPL_NODE_PATH: bundle.paths.node,
    NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S: trustedClientHashes,
    NODE_REPL_TRUSTED_CODE_PATHS: trustedCodePaths,
  };
  if (availableBackends.includes("iab")) {
    env.NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER = BROWSER_USE_IN_APP_INSTRUCTIONS;
  }
  if (availableBackends.includes("chrome")) {
    env.NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME =
      "Control the Chrome browser in conjunction with the Chrome Plugin.";
  }

  const config: BrowserUseThreadConfig = {
    "features.js_repl": false,
    "mcp_servers.node_repl": {
      args: [],
      command: bundle.paths.nodeRepl,
      env,
      startup_timeout_sec: 120,
    },
  };
  if (bundle.manifest.targetPlatform !== "darwin") return config;

  return {
    ...config,
    "shell_environment_policy.set.BROWSER_USE_AVAILABLE_BACKENDS": availableBackendsValue,
    "shell_environment_policy.set.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S":
      trustedClientHashes,
    "shell_environment_policy.set.NODE_REPL_TRUSTED_CODE_PATHS": trustedCodePaths,
  };
}

export class BrowserUseThreadConfigBuilder {
  private readonly availableBackends: () => readonly BrowserRuntimeBackend[];
  private readonly browserRuntime: BrowserRuntimeAvailability;
  private readonly runtimeStateHome: string;

  constructor(options: BrowserUseThreadConfigBuilderOptions) {
    this.availableBackends = options.availableBackends ?? (() => ["iab"]);
    this.browserRuntime = options.browserRuntime;
    this.runtimeStateHome = path.resolve(options.runtimeStateHome);
  }

  buildResult(): BrowserUseThreadConfigResult {
    if (this.browserRuntime.status === "unavailable") return this.browserRuntime;

    let requestedBackends: readonly BrowserRuntimeBackend[];
    try {
      requestedBackends = this.availableBackends();
    } catch (error) {
      return {
        message: error instanceof Error
          ? `Browser backend availability failed: ${error.message}`
          : "Browser backend availability failed",
        reason: "backend-unavailable",
        status: "unavailable",
      };
    }
    const availableBackends = resolveAvailableBrowserUseBackends(
      this.browserRuntime.bundle.manifest.supportedBackends,
      requestedBackends,
    );
    if (availableBackends.length === 0) {
      return {
        message: "Browser runtime bundle is verified, but no browser backend is available",
        reason: "backend-unavailable",
        status: "unavailable",
      };
    }

    return {
      config: buildAvailableConfig(
        this.browserRuntime.bundle,
        this.runtimeStateHome,
        availableBackends,
      ),
      status: "available",
    };
  }

  async build(): Promise<BrowserUseThreadConfig | null> {
    const result = this.buildResult();
    return result.status === "available" ? result.config : null;
  }
}
