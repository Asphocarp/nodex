type BrowserRuntimeCompatibilityManifest = {
  readonly codexCompatibilityVersion?: unknown;
  readonly runtimeVersions?: {
    readonly codexCli?: unknown;
  };
};

export function isBrowserRuntimeCompatibleWithCodex(
  manifest: BrowserRuntimeCompatibilityManifest,
  activeCodexVersion: unknown,
): boolean;
