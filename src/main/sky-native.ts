import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type {
  RemoteHostedPipAnchor,
  RemoteHostedPipPresentationScope,
  RemoteHostedPipViewportRect,
} from "../shared/remote-hosted-pip";

export interface SkyRemoteHostedPipHostRegistration {
  anchors: RemoteHostedPipAnchor[] | null;
  anchorRect: RemoteHostedPipViewportRect | null;
  animated: boolean;
  contentBounds: RemoteHostedPipViewportRect;
  id: string;
  isCodexHomeAvailable: boolean;
  nativeWindowHandle: Buffer | null;
  presentationScope: RemoteHostedPipPresentationScope;
  title: string;
}

export interface SkyNativeAddon {
  completeRemoteHostedPIPContentThread(threadId: string): boolean;
  computerUseServiceProcessMatchesExecutablePath(pid: number, executablePath: string): boolean;
  getRemoteHostedPIPContentActiveTaskIDs(): string[];
  hasRemoteHostedPIPContentAnyPresentation(): boolean;
  invalidateBrowserUsePIPContent(presentationId: string): boolean;
  invalidateRemoteHostedPIPContentTurn(threadId: string, turnId: string): boolean;
  isPrivacySettingsTerminationRequest(): boolean;
  refreshRemoteHostedPIPContentVisibility(threadIds?: string[]): boolean;
  registerRemoteHostedPIPContentHost(input: SkyRemoteHostedPipHostRegistration): boolean;
  setRemoteHostedPIPContentActiveThreadID(threadId: string | null): boolean;
  setRemoteHostedPIPContentComputerUseCursorLocationHandler(
    handler: ((point: { x: number; y: number } | null) => void) | null,
  ): boolean;
  setRemoteHostedPIPContentMaxDisplaySize(size: number): boolean;
  setRemoteHostedPIPContentMaxDisplaySizeChangedHandler(
    handler: ((size: number) => void) | null,
  ): boolean;
  setRemoteHostedPIPContentPetWakeRequestHandler(handler: (() => void) | null): boolean;
  setRemoteHostedPIPContentShouldShowTaskHandler(
    handler: ((threadId: string) => boolean) | null,
  ): boolean;
  setRemoteHostedPIPContentSuppressedThreadIDs(threadIds: string[]): boolean;
  setRemoteHostedPIPContentVisibilityRequestHandler(
    handler: ((isVisible: boolean, threadIds: string[]) => void) | null,
  ): boolean;
  spawnComputerUseService(executablePath: string): Promise<number | null>;
  startRemoteHostedPIPContentHost(tooltips: {
    hide: string;
    placement: string;
  }, onServiceConnectionLost?: () => void): boolean;
  stopRemoteHostedPIPContentHost(): boolean;
  unregisterRemoteHostedPIPContentHost(hostId: string): boolean;
  upsertBrowserUsePIPContent(
    presentationId: string,
    threadId: string,
    imageDataUrl: string,
    appIconPath: string | null,
  ): boolean;
}

const requireFromMain = createRequire(import.meta.url);

function resolveElectronAppPath(): string {
  try {
    const electronModule = requireFromMain("electron") as {
      app?: { getAppPath?: () => string };
    };
    return electronModule.app?.getAppPath?.() ?? process.cwd();
  } catch {
    return process.cwd();
  }
}
const REQUIRED_REMOTE_HOSTED_PIP_EXPORTS = [
  "completeRemoteHostedPIPContentThread",
  "getRemoteHostedPIPContentActiveTaskIDs",
  "hasRemoteHostedPIPContentAnyPresentation",
  "invalidateBrowserUsePIPContent",
  "invalidateRemoteHostedPIPContentTurn",
  "isPrivacySettingsTerminationRequest",
  "refreshRemoteHostedPIPContentVisibility",
  "registerRemoteHostedPIPContentHost",
  "setRemoteHostedPIPContentActiveThreadID",
  "setRemoteHostedPIPContentMaxDisplaySize",
  "setRemoteHostedPIPContentMaxDisplaySizeChangedHandler",
  "setRemoteHostedPIPContentPetWakeRequestHandler",
  "setRemoteHostedPIPContentShouldShowTaskHandler",
  "setRemoteHostedPIPContentSuppressedThreadIDs",
  "setRemoteHostedPIPContentVisibilityRequestHandler",
  "startRemoteHostedPIPContentHost",
  "stopRemoteHostedPIPContentHost",
  "unregisterRemoteHostedPIPContentHost",
  "upsertBrowserUsePIPContent",
] as const;

function hasRequiredExports(value: unknown): value is SkyNativeAddon {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return REQUIRED_REMOTE_HOSTED_PIP_EXPORTS.every(
    (exportName) => typeof candidate[exportName] === "function",
  );
}

export function resolveSkyNativeAddonPath({
  appPath = resolveElectronAppPath(),
  resourcesPath = process.resourcesPath,
}: {
  appPath?: string;
  resourcesPath?: string;
} = {}): string | null {
  const candidates = [
    path.join(resourcesPath, "native", "sky.node"),
    path.join(resourcesPath, "browser-runtime", "native", "sky.node"),
    path.join(appPath, ".generated", "codex-runtime", "agent-runtime", "browser-runtime", "native", "sky.node"),
    path.join(appPath, ".generated", "native-probe-runtime", "browser-runtime", "native", "sky.node"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function loadSkyNativeAddon(options: {
  appPath?: string;
  resourcesPath?: string;
} = {}): SkyNativeAddon | null {
  if (process.platform !== "darwin") return null;
  const addonPath = resolveSkyNativeAddonPath(options);
  if (!addonPath) return null;
  try {
    const addon = requireFromMain(addonPath) as unknown;
    return hasRequiredExports(addon) ? addon : null;
  } catch {
    return null;
  }
}

export function isMacOSVersionAtLeast(
  minimumVersion: string,
  release = process.getSystemVersion?.() ?? "0",
): boolean {
  const expected = minimumVersion.split(".").map(Number);
  const actual = release.split(".").map(Number);
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (actual[index] ?? 0) - (expected[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
