import type {
  AppUpdateSettings,
  AppUpdateStatus,
  UpdateAppUpdateSettingsInput,
} from "../shared/types";
import type {
  MacAppUpdater,
  MacAppUpdaterEvent,
} from "./mac-app-updater";

type StatusListener = (status: AppUpdateStatus) => void;

interface LoggerLike {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
}

interface AppUpdateServiceOptions {
  currentVersion: string;
  isInApplicationsFolder: boolean;
  isPackaged: boolean;
  logger: LoggerLike;
  platform: NodeJS.Platform;
  updater: MacAppUpdater | null;
  initialSettings: AppUpdateSettings;
  persistSettings: (input: UpdateAppUpdateSettingsInput) => AppUpdateSettings;
}

const checkedNow = (): string => new Date().toISOString();

const roundProgressPercent = (received: number, total: number | null): number | null => {
  if (total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((received / total) * 10_000) / 100));
};

export function reduceAppUpdateStatus(
  status: AppUpdateStatus,
  event: MacAppUpdaterEvent,
): AppUpdateStatus {
  if (!status.supported) return status;
  switch (event.type) {
    case "check-started":
      if (status.status === "downloading" || status.status === "downloaded" || status.status === "installing") {
        return status;
      }
      return {
        ...status,
        message: "Checking for updates…",
        progressPercent: null,
        status: "checking",
        totalBytes: null,
        transferredBytes: null,
      };
    case "update-found":
      return {
        ...status,
        availableVersion: event.version,
        checkedAt: checkedNow(),
        message: "Update found. Downloading in the background…",
        releaseDate: event.releaseDate ?? null,
        releaseName: event.releaseName ?? null,
        releaseNotes: event.releaseNotes?.trim() || null,
        status: "available",
      };
    case "download-started":
      return {
        ...status,
        message: "Downloading update…",
        progressPercent: 0,
        status: "downloading",
        totalBytes: event.expectedBytes,
        transferredBytes: 0,
      };
    case "download-progress":
      if (status.status !== "downloading" && status.status !== "available") return status;
      return {
        ...status,
        message: "Downloading update…",
        progressPercent: roundProgressPercent(event.receivedBytes, event.expectedBytes),
        status: "downloading",
        totalBytes: event.expectedBytes,
        transferredBytes: event.receivedBytes,
      };
    case "update-ready": {
      const totalBytes = status.totalBytes;
      return {
        ...status,
        availableVersion: event.version || status.availableVersion,
        checkedAt: checkedNow(),
        message: "Update ready. Restart Nodex to install it.",
        progressPercent: 100,
        releaseDate: event.releaseDate ?? status.releaseDate,
        releaseName: event.releaseName ?? status.releaseName,
        releaseNotes: event.releaseNotes?.trim() || status.releaseNotes,
        status: "downloaded",
        transferredBytes: totalBytes ?? status.transferredBytes,
      };
    }
    case "installing":
      if (status.status !== "downloaded" && status.status !== "installing") return status;
      return { ...status, message: "Installing update…", status: "installing" };
    case "up-to-date":
      return {
        ...status,
        availableVersion: null,
        checkedAt: checkedNow(),
        message: "You’re up to date.",
        progressPercent: null,
        releaseDate: null,
        releaseName: null,
        releaseNotes: null,
        status: "upToDate",
        totalBytes: null,
        transferredBytes: null,
      };
    case "error":
      return {
        ...status,
        checkedAt: checkedNow(),
        message: event.message,
        status: "error",
      };
  }
}

export class AppUpdateService {
  private readonly currentVersion: string;
  private readonly isInApplicationsFolder: boolean;
  private readonly isPackaged: boolean;
  private readonly logger: LoggerLike;
  private readonly platform: NodeJS.Platform;
  private readonly updater: MacAppUpdater | null;
  private readonly persistSettings: AppUpdateServiceOptions["persistSettings"];
  private readonly listeners = new Set<StatusListener>();

  private automaticCheckStarted = false;
  private initializePromise: Promise<void> | null = null;
  private status: AppUpdateStatus;
  private settings: AppUpdateSettings;
  private settingsMutation: Promise<AppUpdateSettings> = Promise.resolve({
    automaticChecksEnabled: true,
    channel: "stable",
  });
  private errorAllowsChannelChange = false;

  constructor(options: AppUpdateServiceOptions) {
    this.currentVersion = options.currentVersion;
    this.isInApplicationsFolder = options.isInApplicationsFolder;
    this.isPackaged = options.isPackaged;
    this.logger = options.logger;
    this.platform = options.platform;
    this.updater = options.updater;
    this.persistSettings = options.persistSettings;
    this.settings = options.initialSettings;
    this.settingsMutation = Promise.resolve(this.settings);
    this.status = this.buildInitialStatus();
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): AppUpdateStatus {
    return this.status;
  }

  getSettings(): AppUpdateSettings {
    return this.settings;
  }

  updateSettings(input: UpdateAppUpdateSettingsInput): Promise<AppUpdateSettings> {
    this.settingsMutation = this.settingsMutation.catch(() => this.settings).then(async () => {
      const next = { ...this.settings, ...input };
      const channelChanged = next.channel !== this.settings.channel;
      if (channelChanged && !this.status.channelChangeAllowed) {
        throw new Error("Update channel cannot change during an update session.");
      }
      if (channelChanged && this.updater) {
        this.initialize();
        await this.initializePromise;
        await this.updater.setChannel(next.channel);
      }
      try {
        const persisted = this.persistSettings(input);
        this.settings = persisted;
      } catch (error) {
        if (channelChanged && this.updater) await this.updater.setChannel(this.settings.channel);
        throw error;
      }
      if (channelChanged) {
        this.setStatus({
          ...this.status,
          availableVersion: null,
          channel: this.settings.channel,
          checkedAt: null,
          message: null,
          progressPercent: null,
          releaseDate: null,
          releaseName: null,
          releaseNotes: null,
          status: "idle",
          totalBytes: null,
          transferredBytes: null,
        });
      }
      return this.settings;
    });
    return this.settingsMutation;
  }

  initialize(): AppUpdateStatus {
    if (this.initializePromise || !this.status.supported || !this.updater) return this.status;
    this.initializePromise = this.updater.setChannel(this.settings.channel).then(() => this.updater!.start((event) => {
      this.errorAllowsChannelChange = event.type === "error" && event.recoverable;
      if (event.type === "error") {
        this.logger.error("App updater emitted an error", {
          code: event.code,
          message: event.message,
          recoverable: event.recoverable,
        });
      }
      this.setStatus(reduceAppUpdateStatus(this.status, event));
    })).then(() => {
      this.logger.info("App updater initialized", {
        currentVersion: this.currentVersion,
        platform: this.platform,
      });
    }).catch((error: unknown) => {
      this.logger.error("App updater initialization failed", { error });
      this.setStatus({
        ...this.status,
        checkedAt: checkedNow(),
        message: error instanceof Error ? error.message : String(error),
        status: "error",
      });
      throw error;
    });
    void this.initializePromise.catch(() => undefined);
    return this.status;
  }

  maybeStartAutomaticChecks(settings: AppUpdateSettings = this.settings): void {
    this.initialize();
    if (!this.status.supported || !settings.automaticChecksEnabled || this.automaticCheckStarted) {
      return;
    }
    this.automaticCheckStarted = true;
    void this.checkForUpdates("startup");
  }

  async checkForUpdates(reason: "startup" | "manual" = "manual"): Promise<AppUpdateStatus> {
    this.initialize();
    if (!this.status.supported || !this.updater) return this.status;
    if (
      this.status.status === "checking"
      || this.status.status === "downloading"
      || this.status.status === "downloaded"
      || this.status.status === "installing"
    ) {
      return this.status;
    }

    this.logger.info("Checking for app updates", {
      currentVersion: this.currentVersion,
      reason,
    });
    try {
      await this.initializePromise;
      await this.updater.check(reason === "startup" ? "background" : "user");
    } catch (error) {
      this.logger.error("App update check failed", { error, reason });
      this.setStatus({
        ...this.status,
        checkedAt: checkedNow(),
        message: error instanceof Error ? error.message : String(error),
        status: "error",
      });
    }
    return this.status;
  }

  async installUpdateAndRestart(): Promise<boolean> {
    this.initialize();
    if (!this.updater || this.status.status !== "downloaded") return false;
    this.logger.info("Installing downloaded app update", {
      version: this.status.availableVersion,
    });
    try {
      await this.updater.installDownloadedUpdate();
      return true;
    } catch (error) {
      this.logger.error("Could not install downloaded app update", { error });
      this.setStatus({
        ...this.status,
        checkedAt: checkedNow(),
        message: error instanceof Error ? error.message : String(error),
        status: "error",
      });
      return false;
    }
  }

  async dispose(): Promise<void> {
    await this.updater?.dispose();
  }

  private buildInitialStatus(): AppUpdateStatus {
    const supported = this.isSupportedRuntime();
    return {
      availableVersion: null,
      buildDefaultChannel: this.updater?.getBuildDefaultChannel() ?? "stable",
      channel: this.settings.channel,
      channelChangeAllowed: supported,
      checkedAt: null,
      currentVersion: this.currentVersion,
      message: supported ? null : this.unsupportedRuntimeMessage(),
      progressPercent: null,
      releaseDate: null,
      releaseName: null,
      releaseNotes: null,
      status: supported ? "idle" : "unsupported",
      supported,
      totalBytes: null,
      transferredBytes: null,
    };
  }

  private isSupportedRuntime(): boolean {
    return this.isPackaged
      && this.platform === "darwin"
      && this.isInApplicationsFolder
      && this.updater !== null;
  }

  private unsupportedRuntimeMessage(): string {
    if (this.isPackaged && this.platform === "darwin" && !this.isInApplicationsFolder) {
      return "Move Nodex to Applications to enable app updates.";
    }
    if (this.isPackaged && this.platform === "darwin" && this.updater === null) {
      return "App updates are disabled in this build.";
    }
    return "App updates are only available in packaged macOS builds.";
  }

  private setStatus(nextStatus: AppUpdateStatus): void {
    const channelChangeAllowed = nextStatus.supported && (
      nextStatus.status === "idle"
      || nextStatus.status === "upToDate"
      || (nextStatus.status === "error" && this.errorAllowsChannelChange)
    );
    this.status = { ...nextStatus, channelChangeAllowed };
    for (const listener of this.listeners) listener(this.status);
  }
}
