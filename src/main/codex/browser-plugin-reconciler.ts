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

type BrowserPluginRequestPort = {
  request(method: string, params?: unknown): Promise<unknown>;
};

export type BrowserPluginReconcileResult =
  | {
    enabled: boolean;
    installedVersion: string;
    status: "ready";
  }
  | {
    message: string;
    reason:
      | "backend-unavailable"
      | "reconciliation-failed"
      | "runtime-unavailable";
    status: "unavailable";
  };

type BrowserPluginReconcilerOptions = {
  availableBackends?: () => readonly BrowserRuntimeBackend[];
  browserRuntime: BrowserRuntimeAvailability;
  client: BrowserPluginRequestPort;
};

type BrowserPluginDesiredState =
  | {
    key: string;
    status: "available";
  }
  | {
    key: string;
    message: string;
    reason: "backend-unavailable" | "runtime-unavailable";
    status: "unavailable";
  };

export class BrowserPluginReconciler {
  private readonly availableBackends: () => readonly BrowserRuntimeBackend[];
  private readonly browserRuntime: BrowserRuntimeAvailability;
  private readonly client: BrowserPluginRequestPort;
  private inFlight: {
    key: string;
    promise: Promise<BrowserPluginReconcileResult>;
  } | null = null;
  private result: {
    key: string;
    value: BrowserPluginReconcileResult;
  } | null = null;

  constructor(options: BrowserPluginReconcilerOptions) {
    this.availableBackends = options.availableBackends ?? (() => ["iab"]);
    this.browserRuntime = options.browserRuntime;
    this.client = options.client;
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

    const operation = this.reconcile(desiredState).then((result) => {
      this.result =
        result.status === "unavailable"
          && result.reason === "reconciliation-failed"
          ? null
          : { key: desiredState.key, value: result };
      return result;
    }).finally(() => {
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
    try {
      requestedBackends = this.availableBackends();
    } catch (error) {
      const message = error instanceof Error
        ? `Browser backend availability failed: ${error.message}`
        : "Browser backend availability failed";
      return {
        key: `backend-unavailable:${message}`,
        message,
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
        key: "backend-unavailable",
        message: "Browser host backend is unavailable",
        reason: "backend-unavailable",
        status: "unavailable",
      };
    }
    return {
      key: `available:${availableBackends.join(",")}`,
      status: "available",
    };
  }

  private async reconcile(
    desiredState: BrowserPluginDesiredState,
  ): Promise<BrowserPluginReconcileResult> {
    try {
      if (desiredState.status === "unavailable") {
        await this.removeInstalledBrowserPlugin();
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
      let marketplace = await this.readBundledMarketplace();
      if (
        marketplace
        && !pathsReferToSameLocation(
          marketplace.marketplacePath,
          bundle.browserPluginMarketplaceRoot,
        )
      ) {
        await this.client.request(
          "marketplace/remove",
          {
            marketplaceName: "openai-bundled",
          } satisfies MarketplaceRemoveParams,
        );
        marketplace = null;
      }
      if (!marketplace) {
        await this.client.request(
          "marketplace/add",
          {
            source: bundle.browserPluginMarketplaceRoot,
          } satisfies MarketplaceAddParams,
        );
        marketplace = await this.readBundledMarketplace();
      }
      const current = marketplace?.plugin
        ? {
            marketplacePath: marketplace.marketplacePath,
            plugin: marketplace.plugin,
          }
        : null;
      if (
        current?.plugin.installed
        && current.plugin.enabled
        && (current.plugin.localVersion ?? current.plugin.version)
          === bundle.manifest.browserPlugin.version
      ) {
        return {
          enabled: true,
          installedVersion: bundle.manifest.browserPlugin.version,
          status: "ready",
        };
      }
      if (!current) {
        return {
          message: "Verified Browser marketplace did not expose the Browser plugin",
          reason: "reconciliation-failed",
          status: "unavailable",
        };
      }

      await this.client.request(
        "plugin/install",
        {
          marketplacePath: current.marketplacePath,
          pluginName: "browser",
        } satisfies PluginInstallParams,
      );
      await this.client.request("skills/list", { forceReload: true });
      const installed = (await this.readBundledMarketplace())?.plugin ?? null;
      const installedVersion = installed?.localVersion
        ?? installed?.version
        ?? null;
      if (
        !installed?.installed
        || !installed.enabled
        || installedVersion !== bundle.manifest.browserPlugin.version
      ) {
        return {
          message: "Browser plugin installation did not produce the verified enabled version",
          reason: "reconciliation-failed",
          status: "unavailable",
        };
      }
      return {
        enabled: true,
        installedVersion,
        status: "ready",
      };
    } catch (error) {
      return {
        message: error instanceof Error
          ? `Browser plugin reconciliation failed: ${error.message}`
          : "Browser plugin reconciliation failed",
        reason: "reconciliation-failed",
        status: "unavailable",
      };
    }
  }

  private async removeInstalledBrowserPlugin(): Promise<void> {
    const current = await this.readBundledMarketplace();
    if (!current?.plugin?.installed && !current?.plugin?.enabled) return;

    await this.client.request(
      "plugin/uninstall",
      {
        pluginId: current.plugin.id,
      } satisfies PluginUninstallParams,
    );
    await this.client.request("skills/list", { forceReload: true });
    const reconciled = (await this.readBundledMarketplace())?.plugin ?? null;
    if (!reconciled?.installed && !reconciled?.enabled) return;
    throw new Error("Browser plugin remained enabled after uninstall");
  }

  private async readBundledMarketplace():
    Promise<{
      marketplacePath: string;
      plugin: PluginListResponse["marketplaces"][number]["plugins"][number] | null;
    } | null> {
    const response = await this.client.request(
      "plugin/list",
      {
        cwds: [],
        marketplaceKinds: ["local"],
      } satisfies PluginListParams,
    ) as PluginListResponse;
    for (const marketplace of response.marketplaces) {
      if (marketplace.name !== "openai-bundled") continue;
      const plugin = marketplace.plugins.find((candidate) => candidate.name === "browser");
      if (!marketplace.path) continue;
      return { marketplacePath: marketplace.path, plugin: plugin ?? null };
    }
    return null;
  }
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
