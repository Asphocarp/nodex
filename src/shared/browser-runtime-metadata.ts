export const BROWSER_RUNTIME_BUNDLE_DIRECTORY = "browser-runtime";
export const BROWSER_RUNTIME_MANIFEST_FILENAME = "browser-runtime-manifest.json";
export const BROWSER_RUNTIME_SCHEMA_VERSION = 4;

export type BrowserRuntimeArtifactArchitecture = "any" | "arm64" | "universal" | "x64";
export type BrowserRuntimeArtifactKind = "data" | "executable" | "native-addon";
export type BrowserRuntimeBackend = "chrome" | "iab";

export type BrowserRuntimeBundledPlugin = {
  docs: string;
  id: "computer-use@openai-bundled";
  manifest: string;
  marketplaceManifest: string;
  marketplaceRoot: string;
  nodeModuleDirs: string[];
  root: string;
  version: string;
};

export type BrowserRuntimeComputerUseCapability =
  | {
    reason: "architecture-unsupported";
    status: "unavailable";
  }
  | {
    appBundle: string;
    appBundleIdentifier: string;
    client: string;
    ipcProtocol: "CodexComputerUseIPC-2";
    minimumMacOSVersion: "14.4";
    plugin: BrowserRuntimeBundledPlugin;
    serviceExecutable: string;
    signingTeamId: string;
    status: "available";
  };

export type BrowserRuntimeNativePipCapability = {
  addon: string;
  controlAssets: string[];
  minimumMacOSVersion: "13.0";
};

export type BrowserRuntimeArtifact = {
  architecture: BrowserRuntimeArtifactArchitecture;
  executable: boolean;
  kind: BrowserRuntimeArtifactKind;
  path: string;
  sha256: string;
  size: number;
};

export type BrowserRuntimeManifest = {
  artifacts: BrowserRuntimeArtifact[];
  browserPlugin: {
    client: string;
    docs: string;
    id: "browser@openai-bundled";
    manifest: string;
    marketplaceManifest: string;
    marketplaceRoot: string;
    nodeModuleDirs: string[];
    root: string;
    version: string;
  };
  capabilities: {
    computerUse: BrowserRuntimeComputerUseCapability;
    nativePip: BrowserRuntimeNativePipCapability;
  };
  buildFlavor: string;
  codexCompatibilityVersion: string;
  desktopBuild: string;
  desktopBuildNumber: string;
  entrypoints: {
    codexCli: string;
    node: string;
    nodeRepl: string;
    peerAuthorization: string;
  };
  peerAuthorization: {
    nodeApiVersion: string;
    signingTeamId: string;
  };
  runtimeVersions: {
    codexCli: string;
    cuaRuntime: string;
    node: string;
    peerAuthorization: string;
  };
  schemaVersion: typeof BROWSER_RUNTIME_SCHEMA_VERSION;
  supportedBackends: BrowserRuntimeBackend[];
  targetArch: "arm64" | "x64";
  targetPlatform: "darwin" | "linux" | "win32";
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSafeBrowserRuntimeRelativePath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function parseNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("\0")
    ? value
    : null;
}

function parseArtifact(value: unknown): BrowserRuntimeArtifact | null {
  if (!isObject(value)) return null;
  if (typeof value.path !== "string" || !isSafeBrowserRuntimeRelativePath(value.path)) return null;
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.sha256)) return null;
  if (typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0) return null;
  if (typeof value.executable !== "boolean") return null;
  if (!["any", "arm64", "universal", "x64"].includes(String(value.architecture))) return null;
  if (!["data", "executable", "native-addon"].includes(String(value.kind))) return null;

  const kind = value.kind as BrowserRuntimeArtifactKind;
  if ((kind === "executable") !== value.executable) return null;
  if (kind === "data" && value.architecture !== "any") return null;
  if (kind === "native-addon" && value.architecture === "any") return null;

  return {
    architecture: value.architecture as BrowserRuntimeArtifactArchitecture,
    executable: value.executable,
    kind,
    path: value.path,
    sha256: value.sha256,
    size: value.size,
  };
}

function parseEntrypoints(value: unknown): BrowserRuntimeManifest["entrypoints"] | null {
  if (!isObject(value)) return null;
  const codexCli = parseNonEmptyString(value.codexCli);
  const node = parseNonEmptyString(value.node);
  const nodeRepl = parseNonEmptyString(value.nodeRepl);
  const peerAuthorization = parseNonEmptyString(value.peerAuthorization);
  if (!codexCli || !node || !nodeRepl || !peerAuthorization) return null;
  if (![codexCli, node, nodeRepl, peerAuthorization].every(isSafeBrowserRuntimeRelativePath)) {
    return null;
  }
  if (new Set([codexCli, node, nodeRepl, peerAuthorization]).size !== 4) return null;
  return { codexCli, node, nodeRepl, peerAuthorization };
}

function parseBrowserPlugin(value: unknown): BrowserRuntimeManifest["browserPlugin"] | null {
  if (!isObject(value) || value.id !== "browser@openai-bundled") return null;
  const version = parseNonEmptyString(value.version);
  const root = parseNonEmptyString(value.root);
  const manifest = parseNonEmptyString(value.manifest);
  const client = parseNonEmptyString(value.client);
  const docs = parseNonEmptyString(value.docs);
  const marketplaceRoot = parseNonEmptyString(value.marketplaceRoot);
  const marketplaceManifest = parseNonEmptyString(value.marketplaceManifest);
  if (
    !version
    || !root
    || !manifest
    || !client
    || !docs
    || !marketplaceRoot
    || !marketplaceManifest
  ) return null;
  const pluginPaths = [
    root,
    manifest,
    client,
    docs,
    marketplaceRoot,
    marketplaceManifest,
  ];
  if (!pluginPaths.every(isSafeBrowserRuntimeRelativePath)) return null;
  const rootPrefix = `${root}/`;
  if (![manifest, client, docs].every((entry) => entry.startsWith(rootPrefix))) return null;
  const marketplaceRootPrefix = `${marketplaceRoot}/`;
  if (
    !root.startsWith(marketplaceRootPrefix)
    || !marketplaceManifest.startsWith(marketplaceRootPrefix)
  ) return null;
  if (!Array.isArray(value.nodeModuleDirs)) return null;
  const nodeModuleDirs = value.nodeModuleDirs.map(parseNonEmptyString);
  if (nodeModuleDirs.some((entry) => entry === null)) return null;
  const parsedNodeModuleDirs = nodeModuleDirs as string[];
  if (
    parsedNodeModuleDirs.length === 0
    || new Set(parsedNodeModuleDirs).size !== parsedNodeModuleDirs.length
    || !parsedNodeModuleDirs.every(isSafeBrowserRuntimeRelativePath)
  ) {
    return null;
  }
  return {
    client,
    docs,
    id: value.id,
    manifest,
    marketplaceManifest,
    marketplaceRoot,
    nodeModuleDirs: parsedNodeModuleDirs,
    root,
    version,
  };
}

function parseComputerUsePlugin(value: unknown): BrowserRuntimeBundledPlugin | null {
  if (!isObject(value) || value.id !== "computer-use@openai-bundled") return null;
  const version = parseNonEmptyString(value.version);
  const root = parseNonEmptyString(value.root);
  const manifest = parseNonEmptyString(value.manifest);
  const docs = parseNonEmptyString(value.docs);
  const marketplaceRoot = parseNonEmptyString(value.marketplaceRoot);
  const marketplaceManifest = parseNonEmptyString(value.marketplaceManifest);
  if (!version || !root || !manifest || !docs || !marketplaceRoot || !marketplaceManifest) {
    return null;
  }
  const pluginPaths = [root, manifest, docs, marketplaceRoot, marketplaceManifest];
  if (!pluginPaths.every(isSafeBrowserRuntimeRelativePath)) return null;
  const rootPrefix = `${root}/`;
  if (![manifest, docs].every((entry) => entry.startsWith(rootPrefix))) return null;
  const marketplaceRootPrefix = `${marketplaceRoot}/`;
  if (!root.startsWith(marketplaceRootPrefix)) return null;
  if (!marketplaceManifest.startsWith(marketplaceRootPrefix)) return null;
  if (!Array.isArray(value.nodeModuleDirs)) return null;
  const nodeModuleDirs = value.nodeModuleDirs.map(parseNonEmptyString);
  if (nodeModuleDirs.some((entry) => entry === null)) return null;
  const parsedNodeModuleDirs = nodeModuleDirs as string[];
  if (
    parsedNodeModuleDirs.length === 0
    || new Set(parsedNodeModuleDirs).size !== parsedNodeModuleDirs.length
    || !parsedNodeModuleDirs.every(isSafeBrowserRuntimeRelativePath)
  ) {
    return null;
  }
  return {
    docs,
    id: value.id,
    manifest,
    marketplaceManifest,
    marketplaceRoot,
    nodeModuleDirs: parsedNodeModuleDirs,
    root,
    version,
  };
}

function parseNativePipCapability(
  value: unknown,
): BrowserRuntimeNativePipCapability | null {
  if (!isObject(value) || value.minimumMacOSVersion !== "13.0") return null;
  const addon = parseNonEmptyString(value.addon);
  if (!addon || !isSafeBrowserRuntimeRelativePath(addon)) return null;
  if (!Array.isArray(value.controlAssets) || value.controlAssets.length !== 2) return null;
  const controlAssets = value.controlAssets.map(parseNonEmptyString);
  if (controlAssets.some((entry) => entry === null)) return null;
  const parsedControlAssets = controlAssets as string[];
  if (
    new Set(parsedControlAssets).size !== parsedControlAssets.length
    || !parsedControlAssets.every(isSafeBrowserRuntimeRelativePath)
  ) {
    return null;
  }
  return { addon, controlAssets: parsedControlAssets, minimumMacOSVersion: "13.0" };
}

function parseComputerUseCapability(
  value: unknown,
): BrowserRuntimeComputerUseCapability | null {
  if (!isObject(value)) return null;
  if (value.status === "unavailable") {
    return value.reason === "architecture-unsupported"
      ? { reason: value.reason, status: value.status }
      : null;
  }
  if (
    value.status !== "available"
    || value.minimumMacOSVersion !== "14.4"
    || value.ipcProtocol !== "CodexComputerUseIPC-2"
  ) {
    return null;
  }
  const appBundle = parseNonEmptyString(value.appBundle);
  const appBundleIdentifier = parseNonEmptyString(value.appBundleIdentifier);
  const client = parseNonEmptyString(value.client);
  const serviceExecutable = parseNonEmptyString(value.serviceExecutable);
  const signingTeamId = parseNonEmptyString(value.signingTeamId);
  const plugin = parseComputerUsePlugin(value.plugin);
  if (!appBundle || !appBundleIdentifier || !client || !serviceExecutable || !signingTeamId || !plugin) {
    return null;
  }
  if (![appBundle, client, serviceExecutable].every(isSafeBrowserRuntimeRelativePath)) return null;
  if (!serviceExecutable.startsWith(`${appBundle}/`)) return null;
  if (!client.startsWith(`${plugin.root}/`)) return null;
  return {
    appBundle,
    appBundleIdentifier,
    client,
    ipcProtocol: value.ipcProtocol,
    minimumMacOSVersion: value.minimumMacOSVersion,
    plugin,
    serviceExecutable,
    signingTeamId,
    status: value.status,
  };
}

function parseRuntimeVersions(
  value: unknown,
): BrowserRuntimeManifest["runtimeVersions"] | null {
  if (!isObject(value)) return null;
  const codexCli = parseNonEmptyString(value.codexCli);
  const cuaRuntime = parseNonEmptyString(value.cuaRuntime);
  const node = parseNonEmptyString(value.node);
  const peerAuthorization = parseNonEmptyString(value.peerAuthorization);
  if (!codexCli || !cuaRuntime || !node || !peerAuthorization) return null;
  return { codexCli, cuaRuntime, node, peerAuthorization };
}

function parsePeerAuthorization(
  value: unknown,
): BrowserRuntimeManifest["peerAuthorization"] | null {
  if (!isObject(value)) return null;
  const nodeApiVersion = parseNonEmptyString(value.nodeApiVersion);
  const signingTeamId = parseNonEmptyString(value.signingTeamId);
  if (!nodeApiVersion || !signingTeamId) return null;
  return { nodeApiVersion, signingTeamId };
}

function parseSupportedBackends(value: unknown): BrowserRuntimeBackend[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((entry) => entry === "iab" || entry === "chrome")) return null;
  const backends = value as BrowserRuntimeBackend[];
  if (new Set(backends).size !== backends.length || !backends.includes("iab")) return null;
  return backends;
}

export function parseBrowserRuntimeManifest(value: unknown): BrowserRuntimeManifest | null {
  if (!isObject(value)) return null;
  if (value.schemaVersion !== BROWSER_RUNTIME_SCHEMA_VERSION) return null;
  if (value.targetArch !== "arm64" && value.targetArch !== "x64") return null;
  if (!["darwin", "linux", "win32"].includes(String(value.targetPlatform))) return null;

  const desktopBuild = parseNonEmptyString(value.desktopBuild);
  const desktopBuildNumber = parseNonEmptyString(value.desktopBuildNumber);
  const buildFlavor = parseNonEmptyString(value.buildFlavor);
  const codexCompatibilityVersion = parseNonEmptyString(value.codexCompatibilityVersion);
  if (
    !desktopBuild
    || !desktopBuildNumber
    || !buildFlavor
    || !codexCompatibilityVersion
  ) return null;

  if (!Array.isArray(value.artifacts)) return null;
  const artifacts = value.artifacts.map(parseArtifact);
  if (artifacts.some((artifact) => artifact === null)) return null;
  const parsedArtifacts = artifacts as BrowserRuntimeArtifact[];
  const artifactsByPath = new Map(parsedArtifacts.map((artifact) => [artifact.path, artifact]));
  if (artifactsByPath.size !== parsedArtifacts.length) return null;

  const entrypoints = parseEntrypoints(value.entrypoints);
  const browserPlugin = parseBrowserPlugin(value.browserPlugin);
  const capabilities = isObject(value.capabilities)
    ? {
      computerUse: parseComputerUseCapability(value.capabilities.computerUse),
      nativePip: parseNativePipCapability(value.capabilities.nativePip),
    }
    : null;
  const peerAuthorization = parsePeerAuthorization(value.peerAuthorization);
  const runtimeVersions = parseRuntimeVersions(value.runtimeVersions);
  const supportedBackends = parseSupportedBackends(value.supportedBackends);
  if (
    !entrypoints
    || !browserPlugin
    || !capabilities?.computerUse
    || !capabilities.nativePip
    || !peerAuthorization
    || !runtimeVersions
    || !supportedBackends
  ) return null;

  const targetArch = value.targetArch;
  const isCompatibleBinary = (artifact: BrowserRuntimeArtifact | undefined): boolean => (
    artifact !== undefined
    && (artifact.architecture === targetArch || artifact.architecture === "universal")
  );
  const codexCli = artifactsByPath.get(entrypoints.codexCli);
  const node = artifactsByPath.get(entrypoints.node);
  const nodeRepl = artifactsByPath.get(entrypoints.nodeRepl);
  const peerAddon = artifactsByPath.get(entrypoints.peerAuthorization);
  if (
    !isCompatibleBinary(codexCli)
    || codexCli?.kind !== "executable"
    || !isCompatibleBinary(node)
    || node?.kind !== "executable"
    || nodeRepl?.kind !== "executable"
    || !(
      nodeRepl.architecture === "any"
      || nodeRepl.architecture === targetArch
      || nodeRepl.architecture === "universal"
    )
    || !isCompatibleBinary(peerAddon)
    || peerAddon?.kind !== "native-addon"
  ) {
    return null;
  }

  const pluginArtifacts = [
    artifactsByPath.get(browserPlugin.manifest),
    artifactsByPath.get(browserPlugin.client),
    artifactsByPath.get(browserPlugin.docs),
    artifactsByPath.get(browserPlugin.marketplaceManifest),
  ];
  if (pluginArtifacts.some((artifact) => artifact?.kind !== "data")) return null;

  const nativePipAddon = artifactsByPath.get(capabilities.nativePip.addon);
  if (!isCompatibleBinary(nativePipAddon) || nativePipAddon?.kind !== "native-addon") return null;
  if (
    capabilities.nativePip.controlAssets.some(
      (assetPath) => artifactsByPath.get(assetPath)?.kind !== "data",
    )
  ) {
    return null;
  }

  if (capabilities.computerUse.status === "available") {
    if (targetArch !== "arm64" || value.targetPlatform !== "darwin") return null;
    const computerUseArtifacts = [
      artifactsByPath.get(capabilities.computerUse.plugin.manifest),
      artifactsByPath.get(capabilities.computerUse.plugin.docs),
      artifactsByPath.get(capabilities.computerUse.plugin.marketplaceManifest),
      artifactsByPath.get(capabilities.computerUse.client),
      artifactsByPath.get(capabilities.computerUse.serviceExecutable),
    ];
    if (computerUseArtifacts.some((artifact) => artifact === undefined)) return null;
    if (computerUseArtifacts.slice(0, 4).some((artifact) => artifact?.kind !== "data")) return null;
    if (computerUseArtifacts[4]?.kind !== "executable") return null;
  }
  if (targetArch === "x64" && capabilities.computerUse.status !== "unavailable") return null;

  return {
    artifacts: parsedArtifacts,
    browserPlugin,
    buildFlavor,
    capabilities: {
      computerUse: capabilities.computerUse,
      nativePip: capabilities.nativePip,
    },
    codexCompatibilityVersion,
    desktopBuild,
    desktopBuildNumber,
    entrypoints,
    peerAuthorization,
    runtimeVersions,
    schemaVersion: value.schemaVersion,
    supportedBackends,
    targetArch,
    targetPlatform: value.targetPlatform as BrowserRuntimeManifest["targetPlatform"],
  };
}
