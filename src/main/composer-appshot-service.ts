import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  desktopCapturer,
  screen,
  type BrowserWindow,
  type DesktopCapturerSource,
  type Rectangle,
} from "electron";
import type {
  CodexComposerAppshotContext,
  CodexComposerAppshotTarget,
  CodexComposerAppshotTargetResult,
} from "../shared/types";
import { getLogger } from "./logging/logger";

const logger = getLogger({
  subsystem: "composer",
  component: "appshot-service",
});
const TRACKING_INTERVAL_MS = 750;
const TRACKING_START_DELAY_MS = 120;
const MAX_HELPER_OUTPUT_BYTES = 128 * 1024;
const MAX_CAPTURE_DIMENSION = 4_096;
const TARGET_HANDLE_LIMIT = 8;

interface HelperWindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ComposerAppshotHelperTarget {
  readonly name: string;
  readonly bundleIdentifier: string;
  readonly processIdentifier: number;
  readonly windowId: number;
  readonly windowTitle: string | null;
  readonly bounds: HelperWindowBounds;
  readonly axTree: string;
}

interface StoredComposerAppshotTarget {
  readonly id: string;
  readonly target: ComposerAppshotHelperTarget;
  readonly iconSmallDataUrl: string | null;
}

export interface ComposerAppshotServiceDependencies {
  readonly platform: NodeJS.Platform;
  readonly processIdentifier: number;
  readonly helperAvailable: () => boolean;
  readonly readFrontmostWindow: (
    signal?: AbortSignal,
  ) => Promise<ComposerAppshotHelperTarget | null>;
  readonly listWindowSources: (thumbnailSize: {
    readonly width: number;
    readonly height: number;
  }) => Promise<readonly DesktopCapturerSource[]>;
  readonly displayScaleFactor: (bounds: HelperWindowBounds) => number;
  readonly createId: () => string;
  readonly scheduleInterval: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  readonly scheduleTimeout: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  readonly clearInterval: (timer: NodeJS.Timeout) => void;
  readonly clearTimeout: (timer: NodeJS.Timeout) => void;
}

export interface ComposerAppshotLiveConfig {
  readonly configuredHelperPath: string | null;
  readonly isPackaged: boolean;
  readonly platform: string;
  readonly projectRootPath: string;
  readonly resourcesPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function parseComposerAppshotHelperTarget(
  value: unknown,
): ComposerAppshotHelperTarget | null {
  if (!isRecord(value)) return null;
  const name = nonEmptyString(value.name);
  const bundleIdentifier = nonEmptyString(value.bundleIdentifier);
  const processIdentifier = finiteNumber(value.processIdentifier);
  const windowId = finiteNumber(value.windowId);
  const windowTitle = value.windowTitle === null ? null : nonEmptyString(value.windowTitle);
  const axTree = typeof value.axTree === "string" ? value.axTree : null;
  if (
    !name ||
    !bundleIdentifier ||
    processIdentifier === null ||
    !Number.isSafeInteger(processIdentifier) ||
    processIdentifier <= 0 ||
    windowId === null ||
    !Number.isSafeInteger(windowId) ||
    windowId <= 0 ||
    axTree === null ||
    !isRecord(value.bounds)
  ) {
    return null;
  }
  const x = finiteNumber(value.bounds.x);
  const y = finiteNumber(value.bounds.y);
  const width = finiteNumber(value.bounds.width);
  const height = finiteNumber(value.bounds.height);
  if (x === null || y === null || width === null || height === null || width < 40 || height < 40) {
    return null;
  }
  return {
    name,
    bundleIdentifier,
    processIdentifier,
    windowId,
    windowTitle,
    bounds: { x, y, width, height },
    axTree,
  };
}

export function resolveComposerAppshotCaptureSize(input: {
  readonly bounds: HelperWindowBounds;
  readonly scaleFactor: number;
}): { readonly width: number; readonly height: number } {
  const scaleFactor = Number.isFinite(input.scaleFactor) ? Math.max(1, input.scaleFactor) : 1;
  const requestedWidth = Math.max(1, Math.ceil(input.bounds.width * scaleFactor));
  const requestedHeight = Math.max(1, Math.ceil(input.bounds.height * scaleFactor));
  const longestDimension = Math.max(requestedWidth, requestedHeight);
  const downscale =
    longestDimension > MAX_CAPTURE_DIMENSION ? MAX_CAPTURE_DIMENSION / longestDimension : 1;
  return {
    width: Math.max(1, Math.round(requestedWidth * downscale)),
    height: Math.max(1, Math.round(requestedHeight * downscale)),
  };
}

export function findComposerAppshotSource<
  T extends {
    readonly id: string;
    readonly name: string;
  },
>(sources: readonly T[], target: ComposerAppshotHelperTarget): T | null {
  const sourcePrefix = `window:${target.windowId}:`;
  const exact = sources.find((source) => source.id.startsWith(sourcePrefix));
  if (exact) return exact;
  const windowTitle = target.windowTitle?.trim();
  if (!windowTitle) return null;
  return sources.find((source) => source.name.trim() === windowTitle) ?? null;
}

export function resolveComposerAppshotWindowTitle(input: {
  readonly axTree: string;
  readonly fallback: string | null;
}): string | null {
  const firstLine = input.axTree.split(/\r?\n/u, 1)[0] ?? "";
  const accessibilityTitle = /^Window:\s*"(.*)",\s*App:/u.exec(firstLine)?.[1]?.trim() ?? "";
  if (accessibilityTitle) return accessibilityTitle;
  return input.fallback?.trim() || null;
}

function sanitizeAppshotFileNamePart(value: string): string {
  const normalized = value.replace(/[/:]/gu, "-").replace(/\s+/gu, " ").trim();
  return normalized || "App";
}

function createAppshotImageName(appName: string): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return `${sanitizeAppshotFileNamePart(appName)} Appshot ${timestamp}.png`;
}

function resolveComposerAppshotHelperExecutable(config: ComposerAppshotLiveConfig): string {
  if (config.configuredHelperPath) return resolve(config.configuredHelperPath);
  if (config.isPackaged) {
    return resolve(config.resourcesPath, "bin", "nodex-appshot-helper");
  }
  return resolve(
    config.projectRootPath,
    ".generated",
    "dev-runtime",
    "bin",
    "nodex-appshot-helper",
  );
}

function runComposerAppshotHelper(
  executable: string,
  signal?: AbortSignal,
): Promise<ComposerAppshotHelperTarget | null> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      executable,
      ["frontmost-window"],
      {
        encoding: "utf8",
        maxBuffer: MAX_HELPER_OUTPUT_BYTES,
        signal,
        timeout: 5_000,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message || "Appshot helper failed"));
          return;
        }
        try {
          resolvePromise(parseComposerAppshotHelperTarget(JSON.parse(stdout)));
        } catch (parseError) {
          reject(
            new Error("Appshot helper returned invalid JSON", {
              cause: parseError,
            }),
          );
        }
      },
    );
  });
}

export function makeComposerAppshotLiveDependencies(
  config: ComposerAppshotLiveConfig,
): ComposerAppshotServiceDependencies {
  const helperExecutable = resolveComposerAppshotHelperExecutable(config);
  return {
    platform: config.platform as NodeJS.Platform,
    processIdentifier: process.pid,
    helperAvailable: () => config.platform === "darwin" && existsSync(helperExecutable),
    readFrontmostWindow: (signal) => runComposerAppshotHelper(helperExecutable, signal),
    listWindowSources: (thumbnailSize) =>
      desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize,
        fetchWindowIcons: true,
      }),
    displayScaleFactor: (bounds) => screen.getDisplayMatching(bounds as Rectangle).scaleFactor,
    createId: randomUUID,
    scheduleInterval: (callback, delayMs) => setInterval(callback, delayMs),
    scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearInterval,
    clearTimeout,
  };
}

export class ComposerAppshotService {
  readonly #dependencies: ComposerAppshotServiceDependencies;
  readonly #focusedWindowIds = new Set<number>();
  readonly #targets = new Map<string, StoredComposerAppshotTarget>();
  readonly #observerReleases = new Set<() => void>();
  #latestTarget: StoredComposerAppshotTarget | null = null;
  #refreshPromise: Promise<StoredComposerAppshotTarget | null> | null = null;
  #refreshController: AbortController | null = null;
  #trackingInterval: NodeJS.Timeout | null = null;
  #trackingStartTimer: NodeJS.Timeout | null = null;
  #disposed = false;

  constructor(dependencies: ComposerAppshotServiceDependencies) {
    this.#dependencies = dependencies;
  }

  observeWindow(window: BrowserWindow): () => void {
    if (this.#disposed) return () => undefined;
    const windowId = window.webContents.id;
    const handleFocus = () => {
      this.#focusedWindowIds.add(windowId);
      this.#stopTracking();
    };
    const handleBlur = () => {
      this.#focusedWindowIds.delete(windowId);
      if (this.#focusedWindowIds.size === 0) this.#startTracking();
    };
    const handleClosed = () => {
      release();
      if (this.#focusedWindowIds.size === 0) this.#startTracking();
    };
    window.on("focus", handleFocus);
    window.on("blur", handleBlur);
    window.on("closed", handleClosed);
    if (window.isFocused()) handleFocus();
    else handleBlur();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      window.off("focus", handleFocus);
      window.off("blur", handleBlur);
      window.off("closed", handleClosed);
      this.#focusedWindowIds.delete(windowId);
      this.#observerReleases.delete(release);
    };
    this.#observerReleases.add(release);
    return release;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stopTracking();
    this.#refreshController?.abort();
    this.#refreshController = null;
    for (const release of [...this.#observerReleases]) release();
    this.#focusedWindowIds.clear();
    this.#targets.clear();
    this.#latestTarget = null;
  }

  async readTarget(): Promise<CodexComposerAppshotTargetResult> {
    if (this.#disposed) return { available: false, target: null };
    if (!this.#isAvailable()) return { available: false, target: null };
    const target = await this.#refreshTarget();
    if (!target) return { available: true, target: null };

    const hydrated = await this.#hydrateTargetIcon(target);
    return {
      available: true,
      target: this.#toPublicTarget(hydrated),
    };
  }

  async capture(targetId: string): Promise<CodexComposerAppshotContext> {
    if (this.#disposed) throw new Error("Appshots are unavailable while Nodex is closing");
    if (!this.#isAvailable()) {
      throw new Error("Appshots are unavailable on this device");
    }
    const stored = this.#targets.get(targetId);
    if (!stored) throw new Error("The Appshot target is no longer available");

    const target = stored.target;
    const thumbnailSize = resolveComposerAppshotCaptureSize({
      bounds: target.bounds,
      scaleFactor: this.#dependencies.displayScaleFactor(target.bounds),
    });
    const sources = await this.#dependencies.listWindowSources(thumbnailSize);
    const source = findComposerAppshotSource(sources, target);
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error(
        "Unable to capture this window. Allow Screen Recording for Nodex and try again.",
      );
    }
    const imageDataUrl = source.thumbnail.toDataURL();
    if (!imageDataUrl.startsWith("data:image/")) {
      throw new Error("The Appshot capture returned an invalid image");
    }
    const appIconDataUrl =
      source.appIcon && !source.appIcon.isEmpty()
        ? source.appIcon.toDataURL()
        : stored.iconSmallDataUrl;
    return {
      id: this.#dependencies.createId(),
      appName: target.name,
      bundleIdentifier: target.bundleIdentifier,
      windowTitle: resolveComposerAppshotWindowTitle({
        axTree: target.axTree,
        fallback: target.windowTitle,
      }),
      axTree: target.axTree,
      imageName: createAppshotImageName(target.name),
      imageDataUrl,
      appIconDataUrl,
    };
  }

  #isAvailable(): boolean {
    return this.#dependencies.platform === "darwin" && this.#dependencies.helperAvailable();
  }

  #startTracking(): void {
    if (this.#disposed || !this.#isAvailable()) return;
    if (this.#trackingInterval || this.#trackingStartTimer) return;
    this.#trackingStartTimer = this.#dependencies.scheduleTimeout(() => {
      this.#trackingStartTimer = null;
      void this.#refreshTarget().catch((error: unknown) => {
        logger.debug("Foreground Appshot target refresh failed", { error });
      });
      this.#trackingInterval = this.#dependencies.scheduleInterval(() => {
        void this.#refreshTarget().catch((error: unknown) => {
          logger.debug("Foreground Appshot target tracking failed", { error });
        });
      }, TRACKING_INTERVAL_MS);
      this.#trackingInterval.unref?.();
    }, TRACKING_START_DELAY_MS);
    this.#trackingStartTimer.unref?.();
  }

  #stopTracking(): void {
    if (this.#trackingStartTimer) {
      this.#dependencies.clearTimeout(this.#trackingStartTimer);
      this.#trackingStartTimer = null;
    }
    if (this.#trackingInterval) {
      this.#dependencies.clearInterval(this.#trackingInterval);
      this.#trackingInterval = null;
    }
  }

  async #refreshTarget(): Promise<StoredComposerAppshotTarget | null> {
    if (this.#refreshPromise) return this.#refreshPromise;
    const controller = new AbortController();
    const refresh = this.#readAndStoreTarget(controller.signal);
    this.#refreshController = controller;
    this.#refreshPromise = refresh;
    try {
      return await refresh;
    } finally {
      if (this.#refreshPromise === refresh) this.#refreshPromise = null;
      if (this.#refreshController === controller) this.#refreshController = null;
    }
  }

  async #readAndStoreTarget(signal?: AbortSignal): Promise<StoredComposerAppshotTarget | null> {
    const candidate = await this.#dependencies.readFrontmostWindow(signal);
    if (this.#disposed) return null;
    if (!candidate || candidate.processIdentifier === this.#dependencies.processIdentifier) {
      return this.#latestTarget;
    }
    const existing = this.#latestTarget;
    const id =
      existing &&
      existing.target.processIdentifier === candidate.processIdentifier &&
      existing.target.windowId === candidate.windowId
        ? existing.id
        : this.#dependencies.createId();
    const stored: StoredComposerAppshotTarget = {
      id,
      target: candidate,
      iconSmallDataUrl: existing?.id === id ? existing.iconSmallDataUrl : null,
    };
    this.#latestTarget = stored;
    this.#targets.delete(id);
    this.#targets.set(id, stored);
    while (this.#targets.size > TARGET_HANDLE_LIMIT) {
      const oldest = this.#targets.keys().next().value;
      if (typeof oldest !== "string") break;
      this.#targets.delete(oldest);
    }
    return stored;
  }

  async #hydrateTargetIcon(
    stored: StoredComposerAppshotTarget,
  ): Promise<StoredComposerAppshotTarget> {
    if (stored.iconSmallDataUrl) return stored;
    try {
      const sources = await this.#dependencies.listWindowSources({
        width: 0,
        height: 0,
      });
      const source = findComposerAppshotSource(sources, stored.target);
      const iconSmallDataUrl =
        source?.appIcon && !source.appIcon.isEmpty()
          ? source.appIcon.resize({ width: 32, height: 32 }).toDataURL()
          : null;
      if (!iconSmallDataUrl || this.#disposed) return stored;
      const hydrated = { ...stored, iconSmallDataUrl };
      this.#targets.set(stored.id, hydrated);
      if (this.#latestTarget?.id === stored.id) this.#latestTarget = hydrated;
      return hydrated;
    } catch (error) {
      logger.debug("Could not resolve the Appshot target icon", { error });
      return stored;
    }
  }

  #toPublicTarget(stored: StoredComposerAppshotTarget): CodexComposerAppshotTarget {
    return {
      id: stored.id,
      appName: stored.target.name,
      bundleIdentifier: stored.target.bundleIdentifier,
      windowTitle: stored.target.windowTitle,
      iconSmallDataUrl: stored.iconSmallDataUrl,
    };
  }
}
