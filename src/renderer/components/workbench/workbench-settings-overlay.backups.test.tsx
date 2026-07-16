import { describe, expect, vi, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { AppProviders } from "@/app-providers";
import { makeDefaultSidebarTopLevelSectionsPrefs } from "@/lib/sidebar-section-prefs";
import { render, settleAsyncRender } from "@/test/dom";
import type {
  BackupRecord,
  DiagnosticsSettings,
  TelemetrySettings,
  UpdateDiagnosticsSettingsInput,
  UpdateTelemetrySettingsInput,
} from "@/lib/types";
import { buildSettingsPath } from "./workbench-settings-routes";

const PROJECTS = [
  {
    id: "default",
    libraryId: "library:test",
    databaseId: "database:test:primary",
    lifecycle: "active" as const,
    bindingRevision: 1,
    name: "Nodex",
    description: "",
    sources: [{ root: "/Users/asc/repo/nodex2", order: 0 }],
    primaryWorkspaceRoot: "/Users/asc/repo/nodex2",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-01T00:00:00.000Z"),
    updated: new Date("2026-03-01T00:00:00.000Z"),
  },
];

let mockInvokeImpl: ((channel: string, ...args: unknown[]) => Promise<unknown>) | null = null;

vi.mock("./workbench-settings-overlay-deps", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    if (!mockInvokeImpl) return null;
    return mockInvokeImpl(channel, ...args);
  },
}));

function buildDiagnosticsSettings(overrides: Partial<DiagnosticsSettings> = {}): DiagnosticsSettings {
  return {
    enabled: false,
    dsn: "",
    environment: "production",
    release: null,
    tracesSampleRate: 0,
    replayEnabled: false,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,
    envOverrides: {
      enabled: false,
      dsn: false,
      environment: false,
      release: false,
      tracesSampleRate: false,
      replayEnabled: false,
      replaysSessionSampleRate: false,
      replaysOnErrorSampleRate: false,
    },
    ...overrides,
  };
}

function buildTelemetrySettings(overrides: Partial<TelemetrySettings> = {}): TelemetrySettings {
  return {
    enabled: false,
    clientKey: "",
    environment: "production",
    autoCaptureEnabled: false,
    envOverrides: {
      enabled: false,
      clientKey: false,
      environment: false,
      autoCaptureEnabled: false,
    },
    ...overrides,
  };
}

async function renderOverlay(path = buildSettingsPath("backups")) {
  const { SettingsRouteShell } = await import("./workbench-settings-overlay");
  return render(
    <AppProviders>
      <SettingsRouteShell
        path={path}
        onPathChange={() => {}}
        onBackToApp={() => {}}
        onRequestProjectPickerOpen={() => {}}
        projects={PROJECTS}
        activeProjectId="default"
        sidebarTopLevelSectionOrder={["recents", "pages", "threads", "files"]}
        sidebarTopLevelSections={makeDefaultSidebarTopLevelSectionsPrefs()}
        onSidebarTopLevelSectionVisibleChange={() => {}}
        threadQueueFollowUpsEnabled={false}
        onThreadQueueFollowUpsEnabledChange={() => {}}
        composerEnterBehavior="enter"
        onComposerEnterBehaviorChange={() => {}}
        worktreeStartMode="autoBranch"
        onWorktreeStartModeChange={() => {}}
        worktreeAutoBranchPrefix="codex/"
        onWorktreeAutoBranchPrefixChange={() => {}}
        smartPrefixParsingEnabled={true}
        onSmartPrefixParsingEnabledChange={() => {}}
        stripSmartPrefixFromTitleEnabled={true}
        onStripSmartPrefixFromTitleEnabledChange={() => {}}
      />
    </AppProviders>,
  );
}

describe("SettingsRouteShell backups", () => {
  test("loads and saves the opt-in diagnostics toggle", async () => {
    let diagnosticsSettings = buildDiagnosticsSettings();
    const diagnosticsUpdates: UpdateDiagnosticsSettingsInput[] = [];

    mockInvokeImpl = async (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case "settings:thread-notifications:get":
          return {
            turnMode: "unfocused",
            permissionsEnabled: true,
            questionsEnabled: true,
          };
        case "settings:app-updates:get":
          return { automaticChecksEnabled: true };
        case "settings:window-restore:get":
          return { policy: "all" };
        case "settings:diagnostics:get":
          return diagnosticsSettings;
        case "settings:diagnostics:update": {
          const input = args[0] as UpdateDiagnosticsSettingsInput;
          diagnosticsUpdates.push(input);
          diagnosticsSettings = {
            ...diagnosticsSettings,
            enabled: input.enabled,
            dsn: input.dsn,
            environment: input.environment,
            release: input.release,
            tracesSampleRate: input.tracesSampleRate,
            replayEnabled: input.replayEnabled,
            replaysSessionSampleRate: input.replaysSessionSampleRate,
            replaysOnErrorSampleRate: input.replaysOnErrorSampleRate,
          };
          return diagnosticsSettings;
        }
        case "settings:telemetry:get":
          return buildTelemetrySettings();
        case "settings:telemetry:update":
          return args[0];
        case "app:update:status":
          return {
            status: "idle",
            supported: true,
            currentVersion: "0.1.0",
            availableVersion: null,
            releaseName: null,
            releaseDate: null,
            releaseNotes: null,
            progressPercent: null,
            transferredBytes: null,
            totalBytes: null,
            checkedAt: null,
            message: null,
          };
        case "worktrees:managed:list":
          return [];
        default:
          return null;
      }
    };

    const view = await renderOverlay(buildSettingsPath("general-settings"));
    await settleAsyncRender();

    view.getByText("Crash reports are off.");
    const toggle = view.getByText("Share crash reports").parentElement?.querySelector("[role='switch']");
    const replayToggle = view.getByText("Share session replays").parentElement?.querySelector("[role='switch']");
    expect(toggle).not.toBeNull();
    expect(replayToggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect((replayToggle as HTMLButtonElement | null)?.disabled ?? false).toBe(true);
    view.getByText("Session replays require crash reports.");

    fireEvent.click(toggle as Element);
    await settleAsyncRender();

    expect(diagnosticsUpdates.length).toBe(1);
    expect(diagnosticsUpdates[0]?.enabled).toBe(true);
    expect(diagnosticsUpdates[0]?.replayEnabled).toBe(false);
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    view.getByText("Crash reports are enabled after restart.");
    view.getByText("Session replays are off.");

    const enabledReplayToggle = view.getByText("Share session replays").parentElement?.querySelector("[role='switch']");
    expect(enabledReplayToggle).not.toBeNull();
    expect((enabledReplayToggle as HTMLButtonElement | null)?.disabled ?? false).toBe(false);

    fireEvent.click(enabledReplayToggle as Element);
    await settleAsyncRender();

    expect(diagnosticsUpdates.length).toBe(2);
    expect(diagnosticsUpdates[1]?.enabled).toBe(true);
    expect(diagnosticsUpdates[1]?.replayEnabled).toBe(true);
    view.getByText("Session replays are enabled after restart.");
  });

  test("shows disabled diagnostics control when env overrides the toggle", async () => {
    const diagnosticsSettings = buildDiagnosticsSettings({
      enabled: true,
      envOverrides: {
        enabled: true,
        dsn: false,
        environment: false,
        release: false,
        tracesSampleRate: false,
        replayEnabled: false,
        replaysSessionSampleRate: false,
        replaysOnErrorSampleRate: false,
      },
    });
    const diagnosticsUpdates: UpdateDiagnosticsSettingsInput[] = [];

    mockInvokeImpl = async (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case "settings:thread-notifications:get":
          return {
            turnMode: "unfocused",
            permissionsEnabled: true,
            questionsEnabled: true,
          };
        case "settings:app-updates:get":
          return { automaticChecksEnabled: true };
        case "settings:window-restore:get":
          return { policy: "all" };
        case "settings:diagnostics:get":
          return diagnosticsSettings;
        case "settings:diagnostics:update":
          diagnosticsUpdates.push(args[0] as UpdateDiagnosticsSettingsInput);
          return diagnosticsSettings;
        case "settings:telemetry:get":
          return buildTelemetrySettings();
        case "settings:telemetry:update":
          return args[0];
        case "app:update:status":
          return {
            status: "idle",
            supported: true,
            currentVersion: "0.1.0",
            availableVersion: null,
            releaseName: null,
            releaseDate: null,
            releaseNotes: null,
            progressPercent: null,
            transferredBytes: null,
            totalBytes: null,
            checkedAt: null,
            message: null,
          };
        case "worktrees:managed:list":
          return [];
        default:
          return null;
      }
    };

    const view = await renderOverlay(buildSettingsPath("general-settings"));
    await settleAsyncRender();

    view.getByText("Managed by NODEX_SENTRY_ENABLED. Environment overrides are active.");
    const toggle = view.getByText("Share crash reports").parentElement?.querySelector("[role='switch']");
    expect(toggle).not.toBeNull();
    expect((toggle as HTMLButtonElement | null)?.disabled ?? false).toBe(true);

    fireEvent.click(toggle as Element);
    await settleAsyncRender();

    expect(diagnosticsUpdates.length).toBe(0);
  });

  test("loads and saves the opt-in telemetry toggles", async () => {
    let telemetrySettings = buildTelemetrySettings();
    const telemetryUpdates: UpdateTelemetrySettingsInput[] = [];

    mockInvokeImpl = async (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case "settings:thread-notifications:get":
          return {
            turnMode: "unfocused",
            permissionsEnabled: true,
            questionsEnabled: true,
          };
        case "settings:app-updates:get":
          return { automaticChecksEnabled: true };
        case "settings:window-restore:get":
          return { policy: "all" };
        case "settings:diagnostics:get":
          return buildDiagnosticsSettings();
        case "settings:diagnostics:update":
          return args[0];
        case "settings:telemetry:get":
          return telemetrySettings;
        case "settings:telemetry:update": {
          const input = args[0] as UpdateTelemetrySettingsInput;
          telemetryUpdates.push(input);
          telemetrySettings = {
            ...telemetrySettings,
            enabled: input.enabled,
            clientKey: input.clientKey,
            environment: input.environment,
            autoCaptureEnabled: input.autoCaptureEnabled,
          };
          return telemetrySettings;
        }
        case "app:update:status":
          return {
            status: "idle",
            supported: true,
            currentVersion: "0.1.0",
            availableVersion: null,
            releaseName: null,
            releaseDate: null,
            releaseNotes: null,
            progressPercent: null,
            transferredBytes: null,
            totalBytes: null,
            checkedAt: null,
            message: null,
          };
        case "worktrees:managed:list":
          return [];
        default:
          return null;
      }
    };

    const view = await renderOverlay(buildSettingsPath("general-settings"));
    await settleAsyncRender();

    view.getByText("Product telemetry is off.");
    const toggle = view.getByText("Share product telemetry").parentElement?.querySelector("[role='switch']");
    const autoCaptureToggle = view.getByText("Share web analytics").parentElement?.querySelector("[role='switch']");
    expect(toggle).not.toBeNull();
    expect(autoCaptureToggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect((autoCaptureToggle as HTMLButtonElement | null)?.disabled ?? false).toBe(true);
    view.getByText("Web analytics require product telemetry.");

    fireEvent.click(toggle as Element);
    await settleAsyncRender();

    expect(telemetryUpdates.length).toBe(1);
    expect(telemetryUpdates[0]?.enabled).toBe(true);
    expect(telemetryUpdates[0]?.autoCaptureEnabled).toBe(false);
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    view.getByText("Product telemetry is enabled after restart.");
    view.getByText("Web analytics are off.");

    const enabledAutoCaptureToggle = view.getByText("Share web analytics").parentElement?.querySelector("[role='switch']");
    expect(enabledAutoCaptureToggle).not.toBeNull();
    expect((enabledAutoCaptureToggle as HTMLButtonElement | null)?.disabled ?? false).toBe(false);

    fireEvent.click(enabledAutoCaptureToggle as Element);
    await settleAsyncRender();

    expect(telemetryUpdates.length).toBe(2);
    expect(telemetryUpdates[1]?.enabled).toBe(true);
    expect(telemetryUpdates[1]?.autoCaptureEnabled).toBe(true);
    view.getByText("Web analytics are enabled after restart.");
  });

  test("shows disabled telemetry control when env overrides the toggle", async () => {
    const telemetrySettings = buildTelemetrySettings({
      enabled: true,
      envOverrides: {
        enabled: true,
        clientKey: false,
        environment: false,
        autoCaptureEnabled: false,
      },
    });
    const telemetryUpdates: UpdateTelemetrySettingsInput[] = [];

    mockInvokeImpl = async (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case "settings:thread-notifications:get":
          return {
            turnMode: "unfocused",
            permissionsEnabled: true,
            questionsEnabled: true,
          };
        case "settings:app-updates:get":
          return { automaticChecksEnabled: true };
        case "settings:window-restore:get":
          return { policy: "all" };
        case "settings:diagnostics:get":
          return buildDiagnosticsSettings();
        case "settings:diagnostics:update":
          return args[0];
        case "settings:telemetry:get":
          return telemetrySettings;
        case "settings:telemetry:update":
          telemetryUpdates.push(args[0] as UpdateTelemetrySettingsInput);
          return telemetrySettings;
        case "app:update:status":
          return {
            status: "idle",
            supported: true,
            currentVersion: "0.1.0",
            availableVersion: null,
            releaseName: null,
            releaseDate: null,
            releaseNotes: null,
            progressPercent: null,
            transferredBytes: null,
            totalBytes: null,
            checkedAt: null,
            message: null,
          };
        case "worktrees:managed:list":
          return [];
        default:
          return null;
      }
    };

    const view = await renderOverlay(buildSettingsPath("general-settings"));
    await settleAsyncRender();

    view.getByText("Managed by NODEX_TELEMETRY_ENABLED. Environment overrides are active.");
    const toggle = view.getByText("Share product telemetry").parentElement?.querySelector("[role='switch']");
    expect(toggle).not.toBeNull();
    expect((toggle as HTMLButtonElement | null)?.disabled ?? false).toBe(true);

    fireEvent.click(toggle as Element);
    await settleAsyncRender();

    expect(telemetryUpdates.length).toBe(0);
  });

  test("treats a malformed backup list response as empty state", async () => {
    mockInvokeImpl = async (channel: string) => {
      switch (channel) {
        case "settings:backup:get":
          return {
            autoEnabled: false,
            intervalHours: 24,
            retentionCount: 10,
            envOverrides: {
              autoEnabled: false,
              intervalHours: false,
              retentionCount: false,
            },
          };
        case "settings:history:get":
          return {
            retentionCount: 1000,
            envOverrides: {
              retentionCount: false,
            },
          };
        case "backup:list":
          return null;
        default:
          return null;
      }
    };

    const view = await renderOverlay();
    await settleAsyncRender();

    view.getByText("No snapshots yet.");
  });

  test("deletes a snapshot through inline row confirmation", async () => {
    const backups: BackupRecord[] = [
      {
        version: 1,
        id: "backup-1",
        createdAt: "2026-04-15T10:00:00.000Z",
        trigger: "manual",
        label: "Before risky change",
        includesAssets: true,
        dbBytes: 1024,
        assetsBytes: 512,
        totalBytes: 1536,
      },
    ];
    const deletedBackupIds: string[] = [];

    mockInvokeImpl = async (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case "settings:backup:get":
          return {
            autoEnabled: false,
            intervalHours: 24,
            retentionCount: 10,
            envOverrides: {
              autoEnabled: false,
              intervalHours: false,
              retentionCount: false,
            },
          };
        case "settings:history:get":
          return {
            retentionCount: 1000,
            envOverrides: {
              retentionCount: false,
            },
          };
        case "backup:list":
          return [...backups];
        case "backup:delete": {
          const [backupId] = args as [string];
          deletedBackupIds.push(backupId);
          const index = backups.findIndex((backup) => backup.id === backupId);
          if (index >= 0) {
            backups.splice(index, 1);
          }
          return {
            success: true,
            deletedBackupId: backupId,
          };
        }
        default:
          return null;
      }
    };

    const view = await renderOverlay();
    await settleAsyncRender();

    fireEvent.click(view.getByRole("button", { name: "Delete snapshot Before risky change" }));
    await settleAsyncRender();

    view.getByRole("button", { name: "Confirm delete" });
    view.getByRole("button", { name: "Cancel" });

    fireEvent.click(view.getByRole("button", { name: "Confirm delete" }));
    await settleAsyncRender();

    expect(deletedBackupIds.length).toBe(1);
    expect(deletedBackupIds[0]).toBe("backup-1");
    expect(view.queryByText("Before risky change")).toBe(null);
    view.getByText("Snapshot deleted.");
  });
});
