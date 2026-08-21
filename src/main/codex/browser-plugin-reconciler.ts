import fs from "node:fs";
import path from "node:path";
import type {
  MarketplaceAddParams,
  MarketplaceRemoveParams,
  PluginInstallParams,
  PluginListParams,
  PluginListResponse,
  PluginUninstallParams,
} from "@nodex/codex-app-server-protocol/v2";
import type { BrowserRuntimeBackend } from "../../shared/browser-runtime-metadata";
import type { BrowserRuntimeAvailability } from "./browser-runtime-bundle";
import { resolveAvailableBrowserUseBackends } from "./browser-use-backends";
import {
  materializeBundledDesktopToolMarketplace,
  type MaterializedDesktopToolMarketplace,
} from "./bundled-desktop-tool-marketplace";

type BrowserPluginRequestPort = {
  request(method: string, params?: unknown): Promise<unknown>;
};

export type ComputerUsePluginReconcileResult =
  | {
      enabled: boolean;
      installedVersion: string;
      pluginRoot: string;
      status: "ready";
    }
  | {
      message: string;
      reason: "capability-unavailable" | "reconciliation-failed";
      status: "unavailable";
    };

export type BrowserPluginReconcileResult =
  | {
      computerUse: ComputerUsePluginReconcileResult;
      enabled: boolean;
      installedVersion: string | null;
      marketplaceRoot: string;
      status: "ready";
    }
  | {
      message: string;
      reason: "backend-unavailable" | "reconciliation-failed" | "runtime-unavailable";
      status: "unavailable";
    };

type BrowserPluginReconcilerOptions = {
  availableBackends?: () => readonly BrowserRuntimeBackend[];
  browserRuntime: BrowserRuntimeAvailability;
  client: BrowserPluginRequestPort;
  computerUseAvailable?: () => boolean;
  runtimeStateHome?: string;
};

type BrowserPluginDesiredState =
  | {
      browserAvailable: boolean;
      computerUseAvailable: boolean;
      key: string;
      status: "available";
    }
  | {
      key: string;
      message: string;
      reason: "backend-unavailable" | "runtime-unavailable";
      status: "unavailable";
    };

type MarketplacePlugin = PluginListResponse["marketplaces"][number]["plugins"][number];

type BundledMarketplaceSnapshot = {
  marketplacePath: string;
  plugins: MarketplacePlugin[];
};

export class BrowserPluginReconciler {
  private readonly availableBackends: () => readonly BrowserRuntimeBackend[];
  private readonly browserRuntime: BrowserRuntimeAvailability;
  private readonly client: BrowserPluginRequestPort;
  private readonly computerUseAvailable: () => boolean;
  private inFlight: {
    key: string;
    promise: Promise<BrowserPluginReconcileResult>;
  } | null = null;
  private result: {
    key: string;
    value: BrowserPluginReconcileResult;
  } | null = null;
  private readonly runtimeStateHome: string;

  constructor(options: BrowserPluginReconcilerOptions) {
    this.availableBackends = options.availableBackends ?? (() => ["iab"]);
    this.browserRuntime = options.browserRuntime;
    this.client = options.client;
    this.computerUseAvailable = options.computerUseAvailable ?? (() => false);
    this.runtimeStateHome = path.resolve(
      options.runtimeStateHome ??
        path.join(
          this.browserRuntime.status === "available"
            ? this.browserRuntime.bundle.rootPath
            : process.cwd(),
          ".state",
        ),
    );
  }

  getResult(): BrowserPluginReconcileResult | null {
    return this.result?.value ?? null;
  }

  reset(): void {
    this.inFlight = null;
    this.result = null;
  }

  async ensureInstalled(): Promise<BrowserPluginReconcileResult> {
    const desiredState = this.resolveDesiredState();
    if (this.result?.key === desiredState.key) return this.result.value;
    if (this.inFlight?.key === desiredState.key) {
      return await this.inFlight.promise;
    }
    if (this.inFlight) {
      await this.inFlight.promise;
      return await this.ensureInstalled();
    }

    const operation = this.reconcile(desiredState)
      .then((result) => {
        this.result =
          result.status === "unavailable" && result.reason === "reconciliation-failed"
            ? null
            : { key: desiredState.key, value: result };
        return result;
      })
      .finally(() => {
        if (this.inFlight?.promise === operation) this.inFlight = null;
      });
    this.inFlight = { key: desiredState.key, promise: operation };
    return await operation;
  }

  private resolveDesiredState(): BrowserPluginDesiredState {
    if (this.browserRuntime.status === "unavailable") {
      return {
        key: "runtime-unavailable",
        message: this.browserRuntime.message,
        reason: "runtime-unavailable",
        status: "unavailable",
      };
    }
    let requestedBackends: readonly BrowserRuntimeBackend[];
    let computerUseAvailable: boolean;
    try {
      requestedBackends = this.availableBackends();
      computerUseAvailable =
        this.computerUseAvailable() &&
        this.browserRuntime.bundle.manifest.capabilities.computerUse.status === "available";
    } catch (error) {
      const message =
        error instanceof Error
          ? `Desktop tool availability failed: ${error.message}`
          : "Desktop tool availability failed";
      return {
        key: `backend-unavailable:${message}`,
        message,
        reason: "backend-unavailable",
        status: "unavailable",
      };
    }
    const browserAvailable =
      resolveAvailableBrowserUseBackends(
        this.browserRuntime.bundle.manifest.supportedBackends,
        requestedBackends,
      ).length > 0;
    if (!browserAvailable && !computerUseAvailable) {
      return {
        key: "backend-unavailable",
        message: "Desktop tool host backends are unavailable",
        reason: "backend-unavailable",
        status: "unavailable",
      };
    }
    return {
      browserAvailable,
      computerUseAvailable,
      key: `available:browser=${String(browserAvailable)};computer-use=${String(computerUseAvailable)}`,
      status: "available",
    };
  }

  private async reconcile(
    desiredState: BrowserPluginDesiredState,
  ): Promise<BrowserPluginReconcileResult> {
    try {
      if (desiredState.status === "unavailable") {
        await this.removeInstalledPlugins();
        return {
          message: desiredState.message,
          reason: desiredState.reason,
          status: "unavailable",
        };
      }
      if (this.browserRuntime.status === "unavailable") {
        return {
          message: this.browserRuntime.message,
          reason: "runtime-unavailable",
          status: "unavailable",
        };
      }
      const bundle = this.browserRuntime.bundle;
      const materialized = await materializeBundledDesktopToolMarketplace({
        bundle,
        includeComputerUse: desiredState.computerUseAvailable,
        runtimeStateHome: this.runtimeStateHome,
      });
      let marketplace = await this.readBundledMarketplace();
      if (
        marketplace &&
        !pathsReferToSameLocation(marketplace.marketplacePath, materialized.rootPath)
      ) {
        await this.client.request("marketplace/remove", {
          marketplaceName: "openai-bundled",
        } satisfies MarketplaceRemoveParams);
        marketplace = null;
      }
      if (!marketplace) {
        await this.client.request("marketplace/add", {
          source: materialized.rootPath,
        } satisfies MarketplaceAddParams);
        marketplace = await this.readBundledMarketplace();
      }
      if (!marketplace) {
        return this.reconciliationFailure(
          "Verified bundled marketplace was not available after registration",
        );
      }

      let changed = false;
      changed =
        (await this.reconcilePlugin({
          current: findPlugin(marketplace, "browser"),
          desired: desiredState.browserAvailable,
          marketplacePath: marketplace.marketplacePath,
          pluginName: "browser",
          version: bundle.manifest.browserPlugin.version,
        })) || changed;
      const computerUseCapability = bundle.manifest.capabilities.computerUse;
      changed =
        (await this.reconcilePlugin({
          current: findPlugin(marketplace, "computer-use"),
          desired: desiredState.computerUseAvailable,
          marketplacePath: marketplace.marketplacePath,
          pluginName: "computer-use",
          version:
            computerUseCapability.status === "available"
              ? computerUseCapability.plugin.version
              : null,
        })) || changed;
      if (changed) {
        await this.client.request("skills/list", { forceReload: true });
        marketplace = await this.readBundledMarketplace();
      }
      if (!marketplace) {
        return this.reconciliationFailure("Bundled marketplace disappeared during reconciliation");
      }

      const browserPlugin = findPlugin(marketplace, "browser");
      const browserReady = desiredState.browserAvailable
        ? isPluginReady(browserPlugin, bundle.manifest.browserPlugin.version)
        : !browserPlugin?.installed && !browserPlugin?.enabled;
      if (!browserReady) {
        return this.reconciliationFailure(
          "Browser plugin reconciliation did not produce the requested state",
        );
      }

      const computerUse = this.resolveComputerUseResult({
        desired: desiredState.computerUseAvailable,
        materialized,
        plugin: findPlugin(marketplace, "computer-use"),
        version:
          computerUseCapability.status === "available"
            ? computerUseCapability.plugin.version
            : null,
      });
      if (
        !desiredState.browserAvailable &&
        desiredState.computerUseAvailable &&
        computerUse.status === "unavailable"
      ) {
        return this.reconciliationFailure(computerUse.message);
      }

      return {
        computerUse,
        enabled: desiredState.browserAvailable,
        installedVersion: desiredState.browserAvailable
          ? bundle.manifest.browserPlugin.version
          : null,
        marketplaceRoot: materialized.rootPath,
        status: "ready",
      };
    } catch (error) {
      return this.reconciliationFailure(
        error instanceof Error
          ? `Desktop tool plugin reconciliation failed: ${error.message}`
          : "Desktop tool plugin reconciliation failed",
      );
    }
  }

  private reconciliationFailure(message: string): BrowserPluginReconcileResult {
    return {
      message,
      reason: "reconciliation-failed",
      status: "unavailable",
    };
  }

  private resolveComputerUseResult(input: {
    desired: boolean;
    materialized: MaterializedDesktopToolMarketplace;
    plugin: MarketplacePlugin | null;
    version: string | null;
  }): ComputerUsePluginReconcileResult {
    if (!input.desired || !input.materialized.computerUsePluginRoot || !input.version) {
      return {
        message: "Computer Use runtime capability is unavailable",
        reason: "capability-unavailable",
        status: "unavailable",
      };
    }
    if (!isPluginReady(input.plugin, input.version)) {
      return {
        message: "Computer Use plugin reconciliation did not produce the verified enabled version",
        reason: "reconciliation-failed",
        status: "unavailable",
      };
    }
    return {
      enabled: true,
      installedVersion: input.version,
      pluginRoot: input.materialized.computerUsePluginRoot,
      status: "ready",
    };
  }

  private async reconcilePlugin(input: {
    current: MarketplacePlugin | null;
    desired: boolean;
    marketplacePath: string;
    pluginName: "browser" | "computer-use";
    version: string | null;
  }): Promise<boolean> {
    if (!input.desired) {
      if (!input.current?.installed && !input.current?.enabled) return false;
      await this.client.request("plugin/uninstall", {
        pluginId: input.current.id,
      } satisfies PluginUninstallParams);
      return true;
    }
    if (!input.version) {
      throw new Error(`${input.pluginName} plugin version is unavailable`);
    }
    if (isPluginReady(input.current, input.version)) return false;
    if (!input.current) {
      throw new Error(`Bundled marketplace did not expose ${input.pluginName}`);
    }
    await this.client.request("plugin/install", {
      marketplacePath: input.marketplacePath,
      pluginName: input.pluginName,
    } satisfies PluginInstallParams);
    return true;
  }

  private async removeInstalledPlugins(): Promise<void> {
    const current = await this.readBundledMarketplace();
    if (!current) return;
    let changed = false;
    for (const pluginName of ["browser", "computer-use"] as const) {
      const plugin = findPlugin(current, pluginName);
      if (!plugin?.installed && !plugin?.enabled) continue;
      await this.client.request("plugin/uninstall", {
        pluginId: plugin.id,
      } satisfies PluginUninstallParams);
      changed = true;
    }
    if (!changed) return;
    await this.client.request("skills/list", { forceReload: true });
    const reconciled = await this.readBundledMarketplace();
    if (!reconciled) return;
    const retained = ["browser", "computer-use"].some((pluginName) => {
      const plugin = findPlugin(reconciled, pluginName as "browser" | "computer-use");
      return plugin?.installed || plugin?.enabled;
    });
    if (retained) throw new Error("Desktop tool plugin remained enabled after uninstall");
  }

  private async readBundledMarketplace(): Promise<BundledMarketplaceSnapshot | null> {
    const response = (await this.client.request("plugin/list", {
      cwds: [],
      marketplaceKinds: ["local"],
    } satisfies PluginListParams)) as PluginListResponse;
    for (const marketplace of response.marketplaces) {
      if (marketplace.name !== "openai-bundled" || !marketplace.path) continue;
      return {
        marketplacePath: marketplace.path,
        plugins: marketplace.plugins,
      };
    }
    return null;
  }
}

function findPlugin(
  marketplace: BundledMarketplaceSnapshot,
  pluginName: "browser" | "computer-use",
): MarketplacePlugin | null {
  return marketplace.plugins.find((candidate) => candidate.name === pluginName) ?? null;
}

function isPluginReady(plugin: MarketplacePlugin | null, version: string): boolean {
  return Boolean(
    plugin?.installed && plugin.enabled && (plugin.localVersion ?? plugin.version) === version,
  );
}

function pathsReferToSameLocation(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

function canonicalPath(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}
