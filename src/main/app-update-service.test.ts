import { describe, expect, test } from "vitest";
import type { AppUpdateSettings } from "../shared/types";
import type {
  MacAppUpdater,
  MacAppUpdaterCheckKind,
  MacAppUpdaterEvent,
} from "./mac-app-updater";
import { AppUpdateService, reduceAppUpdateStatus } from "./app-update-service";

class FakeUpdater implements MacAppUpdater {
  checkKinds: MacAppUpdaterCheckKind[] = [];
  disposeCount = 0;
  installCount = 0;
  startCount = 0;
  private listener: ((event: MacAppUpdaterEvent) => void) | null = null;

  async start(listener: (event: MacAppUpdaterEvent) => void): Promise<void> {
    this.startCount += 1;
    this.listener = listener;
  }

  async check(kind: MacAppUpdaterCheckKind): Promise<void> {
    this.checkKinds.push(kind);
    this.emit({ kind, type: "check-started" });
  }

  async installDownloadedUpdate(): Promise<void> {
    this.installCount += 1;
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
  }

  emit(event: MacAppUpdaterEvent): void {
    this.listener?.(event);
  }
}

function createLogger() {
  return {
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
}

function createService(overrides?: Partial<{
  currentVersion: string;
  isInApplicationsFolder: boolean;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  updater: FakeUpdater | null;
}>) {
  const updater = overrides && "updater" in overrides
    ? overrides.updater ?? null
    : new FakeUpdater();
  const service = new AppUpdateService({
    currentVersion: overrides?.currentVersion ?? "0.2.1",
    isInApplicationsFolder: overrides?.isInApplicationsFolder ?? true,
    isPackaged: overrides?.isPackaged ?? true,
    logger: createLogger(),
    platform: overrides?.platform ?? "darwin",
    updater,
  });
  return { service, updater };
}

const automaticChecksEnabled: AppUpdateSettings = {
  automaticChecksEnabled: true,
};

describe("AppUpdateService", () => {
  test("reports unsupported outside packaged macOS builds", () => {
    const { service } = createService({ isPackaged: false, platform: "linux" });

    expect(service.initialize()).toMatchObject({
      currentVersion: "0.2.1",
      status: "unsupported",
      supported: false,
    });
  });

  test("keeps disabled builds offline without starting the native updater", () => {
    const { service } = createService({ updater: null });

    expect(service.initialize()).toMatchObject({
      message: "App updates are disabled in this build.",
      status: "unsupported",
    });
  });

  test("requires installation in Applications", () => {
    const { service, updater } = createService({ isInApplicationsFolder: false });

    expect(service.initialize()).toMatchObject({
      message: "Move Nodex to Applications to enable app updates.",
      status: "unsupported",
    });
    expect(updater?.startCount).toBe(0);
  });

  test("starts exactly one background check when enabled", async () => {
    const { service, updater } = createService();

    service.maybeStartAutomaticChecks(automaticChecksEnabled);
    service.maybeStartAutomaticChecks(automaticChecksEnabled);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updater?.startCount).toBe(1);
    expect(updater?.checkKinds).toEqual(["background"]);
  });

  test("tracks no-update checks", async () => {
    const { service, updater } = createService();

    await service.checkForUpdates("manual");
    updater?.emit({ type: "up-to-date", version: "0.2.1" });

    expect(service.getStatus()).toMatchObject({
      message: "You’re up to date.",
      status: "upToDate",
      supported: true,
    });
    expect(updater?.checkKinds).toEqual(["user"]);
  });

  test("tracks download progress and installs only after download completes", async () => {
    const { service, updater } = createService();
    await service.checkForUpdates("manual");
    updater?.emit({
      buildVersion: "202",
      releaseDate: "2026-08-02T00:00:00.000Z",
      releaseName: "Nodex 0.2.2",
      releaseNotes: "Bug fixes",
      type: "update-found",
      version: "0.2.2",
    });
    updater?.emit({ expectedBytes: 1_024, type: "download-started" });
    updater?.emit({ expectedBytes: 1_024, receivedBytes: 513, type: "download-progress" });

    expect(service.getStatus()).toMatchObject({
      availableVersion: "0.2.2",
      progressPercent: 50.1,
      status: "downloading",
      totalBytes: 1_024,
      transferredBytes: 513,
    });
    expect(await service.installUpdateAndRestart()).toBe(false);

    updater?.emit({ buildVersion: "202", type: "update-ready", version: "0.2.2" });
    expect(service.getStatus()).toMatchObject({
      message: "Update ready. Restart Nodex to install it.",
      progressPercent: 100,
      status: "downloaded",
    });
    await service.checkForUpdates("manual");
    expect(updater?.checkKinds).toEqual(["user"]);
    expect(await service.installUpdateAndRestart()).toBe(true);
    expect(updater?.installCount).toBe(1);
  });

  test("does not let late progress move a ready update backwards", () => {
    const initial = createService().service.initialize();
    const ready = reduceAppUpdateStatus(initial, {
      buildVersion: "202",
      type: "update-ready",
      version: "0.2.2",
    });

    expect(reduceAppUpdateStatus(ready, {
      expectedBytes: 100,
      receivedBytes: 50,
      type: "download-progress",
    })).toBe(ready);
  });

  test("surfaces structured updater errors and disposes the adapter", async () => {
    const { service, updater } = createService();
    await service.checkForUpdates("manual");
    updater?.emit({
      code: "NSURLErrorDomain:-1009",
      message: "network failed",
      recoverable: true,
      type: "error",
    });

    expect(service.getStatus()).toMatchObject({ message: "network failed", status: "error" });
    await service.dispose();
    expect(updater?.disposeCount).toBe(1);
  });
});
