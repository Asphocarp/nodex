import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Extension, Extensions } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  BrowserCapabilityStatus,
  BrowserExtensionSummary,
  BrowserExtensionsSnapshot,
} from "../../shared/browser-profile";

type ElectronExtensionsApi = Pick<
  Extensions,
  "getAllExtensions" | "loadExtension" | "removeExtension"
>;

export class BrowserExtensionsRuntimeError extends Schema.TaggedError<BrowserExtensionsRuntimeError>()(
  "BrowserExtensionsRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export interface BrowserExtensionsRuntime {
  readonly capability: () => BrowserCapabilityStatus;
  readonly snapshot: Effect.Effect<BrowserExtensionsSnapshot, BrowserExtensionsRuntimeError>;
  readonly load: (
    extensionPath: string,
  ) => Effect.Effect<BrowserExtensionSummary, BrowserExtensionsRuntimeError>;
  readonly remove: (extensionId: string) => Effect.Effect<void, BrowserExtensionsRuntimeError>;
}

const runtimeError = (operation: string, cause: unknown): BrowserExtensionsRuntimeError =>
  new BrowserExtensionsRuntimeError({ operation, cause });

export const makeBrowserExtensionsRuntime = (
  extensions: ElectronExtensionsApi | null,
): BrowserExtensionsRuntime => {
  const capability = (): BrowserCapabilityStatus => {
    if (
      extensions &&
      typeof extensions.getAllExtensions === "function" &&
      typeof extensions.loadExtension === "function" &&
      typeof extensions.removeExtension === "function"
    ) {
      return { available: true, provider: "electron-public-api" };
    }
    return {
      available: false,
      provider: "unavailable",
      reason: "Electron Browser extensions are unavailable in this build",
    };
  };
  const requireExtensions = (): ElectronExtensionsApi => {
    if (extensions && capability().available) return extensions;
    throw new Error("Browser extensions are unavailable");
  };

  return {
    capability,
    snapshot: Effect.try({
      try: () => {
        const currentCapability = capability();
        if (!currentCapability.available || !extensions) {
          return { capability: currentCapability, extensions: [] };
        }
        return {
          capability: currentCapability,
          extensions: extensions
            .getAllExtensions()
            .map(toSummary)
            .sort((left, right) => left.name.localeCompare(right.name)),
        };
      },
      catch: (cause) => runtimeError("snapshot", cause),
    }),
    load: (extensionPath) =>
      Effect.gen(function* () {
        const api = yield* Effect.try({
          try: () => {
            const resolvedPath = path.resolve(extensionPath);
            const metadata = fs.lstatSync(resolvedPath);
            if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
              throw new Error("Browser extension path must be a regular directory");
            }
            const manifestMetadata = fs.lstatSync(path.join(resolvedPath, "manifest.json"));
            if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
              throw new Error("Browser extension manifest is missing");
            }
            return { api: requireExtensions(), resolvedPath };
          },
          catch: (cause) => runtimeError("validate-load", cause),
        });
        const loaded = yield* Effect.tryPromise({
          try: () => api.api.loadExtension(api.resolvedPath, { allowFileAccess: false }),
          catch: (cause) => runtimeError("load", cause),
        });
        return toSummary(loaded);
      }),
    remove: (extensionId) =>
      Effect.try({
        try: () => requireExtensions().removeExtension(extensionId),
        catch: (cause) => runtimeError("remove", cause),
      }),
  };
};

const toSummary = (extension: Extension): BrowserExtensionSummary => {
  const manifestVersion = extension.manifest?.version;
  return {
    id: extension.id,
    name: extension.name,
    version: extension.version ?? (typeof manifestVersion === "string" ? manifestVersion : ""),
    path: extension.path,
    url: extension.url,
  };
};
