import type { BrowserRuntimeManifest } from "./browser-runtime-metadata";
import { isBrowserRuntimeCompatibleWithCodex as isCompatible } from "./browser-runtime-codex-compatibility.mjs";

export function isBrowserRuntimeCompatibleWithCodex(
  manifest: Pick<BrowserRuntimeManifest, "codexCompatibilityVersion" | "runtimeVersions">,
  activeCodexVersion: string,
): boolean {
  return isCompatible(manifest, activeCodexVersion);
}
