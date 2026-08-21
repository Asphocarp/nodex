import fs from "node:fs";
import path from "node:path";
import type {
  BrowserCapabilityStatus,
  BrowserExtensionSummary,
  BrowserExtensionsSnapshot,
} from "../../shared/browser-profile";

interface ElectronExtension {
  id: string;
  name: string;
  path: string;
  url: string;
  version?: string;
  manifest?: { version?: unknown };
}

interface ElectronExtensionsApi {
  getAllExtensions(): ElectronExtension[];
  loadExtension(
    extensionPath: string,
    options?: {
      allowFileAccess?: boolean;
    },
  ): Promise<ElectronExtension>;
  removeExtension(extensionId: string): void;
}

export class BrowserExtensionsProvider {
  constructor(private readonly extensions: ElectronExtensionsApi | null) {}

  capability(): BrowserCapabilityStatus {
    if (
      this.extensions &&
      typeof this.extensions.getAllExtensions === "function" &&
      typeof this.extensions.loadExtension === "function" &&
      typeof this.extensions.removeExtension === "function"
    ) {
      return {
        available: true,
        provider: "electron-public-api",
      };
    }
    return {
      available: false,
      provider: "unavailable",
      reason: "Electron Browser extensions are unavailable in this build",
    };
  }

  snapshot(): BrowserExtensionsSnapshot {
    const capability = this.capability();
    if (!capability.available || !this.extensions) {
      return { capability, extensions: [] };
    }
    return {
      capability,
      extensions: this.extensions
        .getAllExtensions()
        .map(toSummary)
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  async load(extensionPath: string): Promise<BrowserExtensionSummary> {
    const extensions = this.requireExtensions();
    const resolvedPath = path.resolve(extensionPath);
    const metadata = fs.lstatSync(resolvedPath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Browser extension path must be a regular directory");
    }
    const manifestPath = path.join(resolvedPath, "manifest.json");
    const manifestMetadata = fs.lstatSync(manifestPath);
    if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
      throw new Error("Browser extension manifest is missing");
    }
    return toSummary(
      await extensions.loadExtension(resolvedPath, {
        allowFileAccess: false,
      }),
    );
  }

  remove(extensionId: string): void {
    this.requireExtensions().removeExtension(extensionId);
  }

  private requireExtensions(): ElectronExtensionsApi {
    if (!this.extensions || !this.capability().available) {
      throw new Error("Browser extensions are unavailable");
    }
    return this.extensions;
  }
}

function toSummary(extension: ElectronExtension): BrowserExtensionSummary {
  const manifestVersion = extension.manifest?.version;
  return {
    id: extension.id,
    name: extension.name,
    version: extension.version ?? (typeof manifestVersion === "string" ? manifestVersion : ""),
    path: extension.path,
    url: extension.url,
  };
}
