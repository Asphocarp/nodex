import { readFileSync } from "node:fs";
import path from "node:path";

import type {
  MacAppUpdater,
  MacAppUpdaterCheckKind,
  MacAppUpdaterEvent,
} from "./mac-app-updater";
import {
  loadSparkleNativeBinding,
  parseSparkleNativeEvent,
} from "./sparkle-native-binding";

type RuntimeArchitecture = "arm64" | "x64";

const SPARKLE_ARCHIVE_SHA256 = "ce89daf967db1e1893ed3ebd67575ed82d3902563e3191ca92aaec9164fbdef9";
const SPARKLE_PUBLIC_KEY = "YNySLZ74gjVAOpEdMo9OOEPvuTEMZf8fMnI+oQD7Ifs=";
const SPARKLE_VERSION = "2.9.4";

interface SparkleRuntimeConfig {
  readonly architecture: RuntimeArchitecture;
  readonly channel: "disabled" | "stable";
  readonly feedUrl: string | null;
  readonly publicKey: string;
  readonly sparkleVersion: string;
}

interface SparkleMacAppUpdaterOptions {
  readonly applicationBundlePath: string;
  readonly architecture: RuntimeArchitecture;
  readonly resourcesPath: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertExactKeys = (value: Record<string, unknown>, expected: readonly string[]): void => {
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...expected].sort())) {
    throw new Error("Packaged Sparkle runtime manifest has an unsupported shape.");
  }
};

export function parseSparkleRuntimeConfig(value: unknown): SparkleRuntimeConfig {
  if (!isRecord(value)) throw new Error("Packaged Sparkle runtime manifest must be an object.");
  assertExactKeys(value, [
    "architecture",
    "artifacts",
    "channel",
    "feedUrl",
    "minimumMacOS",
    "publicKey",
    "schemaVersion",
    "sparkleArchiveSha256",
    "sparkleVersion",
  ]);
  if (value.schemaVersion !== 2 || (value.architecture !== "arm64" && value.architecture !== "x64")) {
    throw new Error("Packaged Sparkle runtime manifest version or architecture is invalid.");
  }
  if (value.channel !== "disabled" && value.channel !== "stable") {
    throw new Error("Packaged Sparkle update channel is invalid.");
  }
  const expectedFeed = `https://nodex.jyu.app/updates/stable/${value.architecture}/appcast.xml`;
  if (
    (value.channel === "disabled" && value.feedUrl !== null)
    || (value.channel === "stable" && value.feedUrl !== expectedFeed)
  ) {
    throw new Error("Packaged Sparkle feed does not match its architecture and channel.");
  }
  if (
    value.minimumMacOS !== "12.0"
    || value.sparkleVersion !== SPARKLE_VERSION
    || value.sparkleArchiveSha256 !== SPARKLE_ARCHIVE_SHA256
    || value.publicKey !== SPARKLE_PUBLIC_KEY
    || !isRecord(value.artifacts)
  ) {
    throw new Error("Packaged Sparkle runtime identity is invalid.");
  }
  return {
    architecture: value.architecture,
    channel: value.channel,
    feedUrl: value.feedUrl as string | null,
    publicKey: value.publicKey,
    sparkleVersion: value.sparkleVersion,
  };
}

export function readSparkleRuntimeConfig(resourcesPath: string): SparkleRuntimeConfig {
  const manifestPath = path.join(resourcesPath, "native", "sparkle-runtime.json");
  return parseSparkleRuntimeConfig(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
}

export class SparkleMacAppUpdater implements MacAppUpdater {
  private readonly options: SparkleMacAppUpdaterOptions;
  private readonly config: SparkleRuntimeConfig;
  private binding: ReturnType<typeof loadSparkleNativeBinding> | null = null;
  private checkInFlight = false;
  private disposed = false;
  private readyToInstall = false;
  private started = false;

  constructor(options: SparkleMacAppUpdaterOptions, config: SparkleRuntimeConfig) {
    this.options = options;
    this.config = config;
  }

  async start(onEvent: (event: MacAppUpdaterEvent) => void): Promise<void> {
    if (this.disposed) throw new Error("Sparkle updater has been disposed.");
    if (this.started) throw new Error("Sparkle updater has already started.");
    if (!this.config.feedUrl) throw new Error("Disabled Sparkle updater cannot be started.");
    const binding = loadSparkleNativeBinding(this.options.resourcesPath);
    const runtime = binding.initialize({
      applicationBundlePath: this.options.applicationBundlePath,
      feedUrl: this.config.feedUrl,
      hostBundlePath: this.options.applicationBundlePath,
    }, (value) => {
      if (this.disposed) return;
      const event = parseSparkleNativeEvent(value);
      if (event.type === "update-ready") this.readyToInstall = true;
      if (event.type === "up-to-date" || event.type === "update-ready" || event.type === "error") {
        this.checkInFlight = false;
      }
      onEvent(event);
    });
    if (
      runtime.architecture !== this.options.architecture
      || runtime.sparkleVersion !== this.config.sparkleVersion
    ) {
      binding.dispose();
      throw new Error("Loaded Sparkle runtime does not match its packaged manifest.");
    }
    this.binding = binding;
    this.started = true;
  }

  async check(kind: MacAppUpdaterCheckKind): Promise<void> {
    if (this.disposed || !this.started || !this.binding) {
      throw new Error("Sparkle updater is not running.");
    }
    if (this.checkInFlight) return;
    this.checkInFlight = true;
    this.readyToInstall = false;
    try {
      this.binding.checkForUpdates(kind);
    } catch (error) {
      this.checkInFlight = false;
      throw error;
    }
  }

  async installDownloadedUpdate(): Promise<void> {
    if (this.disposed || !this.started || !this.binding || !this.readyToInstall) {
      throw new Error("No downloaded Sparkle update is ready to install.");
    }
    this.binding.installDownloadedUpdate();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.binding?.dispose();
    this.binding = null;
    this.checkInFlight = false;
    this.readyToInstall = false;
  }
}

export function createPackagedMacAppUpdater(
  options: SparkleMacAppUpdaterOptions,
): MacAppUpdater | null {
  const config = readSparkleRuntimeConfig(options.resourcesPath);
  if (config.architecture !== options.architecture) {
    throw new Error("Packaged Sparkle architecture does not match Electron.");
  }
  if (config.channel === "disabled") return null;
  return new SparkleMacAppUpdater(options, config);
}
