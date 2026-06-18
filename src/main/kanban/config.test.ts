import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_BACKUP_ENV = {
  autoEnabled: process.env.KANBAN_BACKUP_AUTO_ENABLED,
  intervalHours: process.env.KANBAN_BACKUP_INTERVAL_HOURS,
  retention: process.env.KANBAN_BACKUP_RETENTION,
  historyRetention: process.env.KANBAN_HISTORY_RETENTION,
  sentryEnabled: process.env.NODEX_SENTRY_ENABLED,
  sentryDsn: process.env.SENTRY_DSN,
  sentryEnvironment: process.env.SENTRY_ENVIRONMENT,
  sentryRelease: process.env.SENTRY_RELEASE,
  sentryTracesSampleRate: process.env.NODEX_SENTRY_TRACES_SAMPLE_RATE,
  sentryReplayEnabled: process.env.NODEX_SENTRY_REPLAY_ENABLED,
  sentryReplaysSessionSampleRate:
    process.env.NODEX_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
  sentryReplaysOnErrorSampleRate:
    process.env.NODEX_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
  telemetryEnabled: process.env.NODEX_TELEMETRY_ENABLED,
  statsigClientKey: process.env.STATSIG_CLIENT_KEY,
  statsigEnvironment: process.env.STATSIG_ENVIRONMENT,
  telemetryAutoCaptureEnabled: process.env.NODEX_TELEMETRY_AUTOCAPTURE_ENABLED,
};

async function importConfigModule() {
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return import(`./config.ts?test=${token}`);
}

function clearBackupEnv(): void {
  delete process.env.KANBAN_BACKUP_AUTO_ENABLED;
  delete process.env.KANBAN_BACKUP_INTERVAL_HOURS;
  delete process.env.KANBAN_BACKUP_RETENTION;
  delete process.env.KANBAN_HISTORY_RETENTION;
  delete process.env.NODEX_SENTRY_ENABLED;
  delete process.env.SENTRY_DSN;
  delete process.env.SENTRY_ENVIRONMENT;
  delete process.env.SENTRY_RELEASE;
  delete process.env.NODEX_SENTRY_TRACES_SAMPLE_RATE;
  delete process.env.NODEX_SENTRY_REPLAY_ENABLED;
  delete process.env.NODEX_SENTRY_REPLAYS_SESSION_SAMPLE_RATE;
  delete process.env.NODEX_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE;
  delete process.env.NODEX_TELEMETRY_ENABLED;
  delete process.env.STATSIG_CLIENT_KEY;
  delete process.env.STATSIG_ENVIRONMENT;
  delete process.env.NODEX_TELEMETRY_AUTOCAPTURE_ENABLED;
}

function restoreProcessState(): void {
  process.chdir(ORIGINAL_CWD);

  if (ORIGINAL_HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = ORIGINAL_HOME;
  }

  if (ORIGINAL_BACKUP_ENV.autoEnabled === undefined) {
    delete process.env.KANBAN_BACKUP_AUTO_ENABLED;
  } else {
    process.env.KANBAN_BACKUP_AUTO_ENABLED = ORIGINAL_BACKUP_ENV.autoEnabled;
  }
  if (ORIGINAL_BACKUP_ENV.intervalHours === undefined) {
    delete process.env.KANBAN_BACKUP_INTERVAL_HOURS;
  } else {
    process.env.KANBAN_BACKUP_INTERVAL_HOURS = ORIGINAL_BACKUP_ENV.intervalHours;
  }
  if (ORIGINAL_BACKUP_ENV.retention === undefined) {
    delete process.env.KANBAN_BACKUP_RETENTION;
  } else {
    process.env.KANBAN_BACKUP_RETENTION = ORIGINAL_BACKUP_ENV.retention;
  }
  if (ORIGINAL_BACKUP_ENV.historyRetention === undefined) {
    delete process.env.KANBAN_HISTORY_RETENTION;
  } else {
    process.env.KANBAN_HISTORY_RETENTION = ORIGINAL_BACKUP_ENV.historyRetention;
  }
  if (ORIGINAL_BACKUP_ENV.sentryEnabled === undefined) {
    delete process.env.NODEX_SENTRY_ENABLED;
  } else {
    process.env.NODEX_SENTRY_ENABLED = ORIGINAL_BACKUP_ENV.sentryEnabled;
  }
  if (ORIGINAL_BACKUP_ENV.sentryDsn === undefined) {
    delete process.env.SENTRY_DSN;
  } else {
    process.env.SENTRY_DSN = ORIGINAL_BACKUP_ENV.sentryDsn;
  }
  if (ORIGINAL_BACKUP_ENV.sentryEnvironment === undefined) {
    delete process.env.SENTRY_ENVIRONMENT;
  } else {
    process.env.SENTRY_ENVIRONMENT = ORIGINAL_BACKUP_ENV.sentryEnvironment;
  }
  if (ORIGINAL_BACKUP_ENV.sentryRelease === undefined) {
    delete process.env.SENTRY_RELEASE;
  } else {
    process.env.SENTRY_RELEASE = ORIGINAL_BACKUP_ENV.sentryRelease;
  }
  if (ORIGINAL_BACKUP_ENV.sentryTracesSampleRate === undefined) {
    delete process.env.NODEX_SENTRY_TRACES_SAMPLE_RATE;
  } else {
    process.env.NODEX_SENTRY_TRACES_SAMPLE_RATE = ORIGINAL_BACKUP_ENV.sentryTracesSampleRate;
  }
  if (ORIGINAL_BACKUP_ENV.sentryReplayEnabled === undefined) {
    delete process.env.NODEX_SENTRY_REPLAY_ENABLED;
  } else {
    process.env.NODEX_SENTRY_REPLAY_ENABLED = ORIGINAL_BACKUP_ENV.sentryReplayEnabled;
  }
  if (ORIGINAL_BACKUP_ENV.sentryReplaysSessionSampleRate === undefined) {
    delete process.env.NODEX_SENTRY_REPLAYS_SESSION_SAMPLE_RATE;
  } else {
    process.env.NODEX_SENTRY_REPLAYS_SESSION_SAMPLE_RATE =
      ORIGINAL_BACKUP_ENV.sentryReplaysSessionSampleRate;
  }
  if (ORIGINAL_BACKUP_ENV.sentryReplaysOnErrorSampleRate === undefined) {
    delete process.env.NODEX_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE;
  } else {
    process.env.NODEX_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE =
      ORIGINAL_BACKUP_ENV.sentryReplaysOnErrorSampleRate;
  }
  if (ORIGINAL_BACKUP_ENV.telemetryEnabled === undefined) {
    delete process.env.NODEX_TELEMETRY_ENABLED;
  } else {
    process.env.NODEX_TELEMETRY_ENABLED = ORIGINAL_BACKUP_ENV.telemetryEnabled;
  }
  if (ORIGINAL_BACKUP_ENV.statsigClientKey === undefined) {
    delete process.env.STATSIG_CLIENT_KEY;
  } else {
    process.env.STATSIG_CLIENT_KEY = ORIGINAL_BACKUP_ENV.statsigClientKey;
  }
  if (ORIGINAL_BACKUP_ENV.statsigEnvironment === undefined) {
    delete process.env.STATSIG_ENVIRONMENT;
  } else {
    process.env.STATSIG_ENVIRONMENT = ORIGINAL_BACKUP_ENV.statsigEnvironment;
  }
  if (ORIGINAL_BACKUP_ENV.telemetryAutoCaptureEnabled === undefined) {
    delete process.env.NODEX_TELEMETRY_AUTOCAPTURE_ENABLED;
  } else {
    process.env.NODEX_TELEMETRY_AUTOCAPTURE_ENABLED =
      ORIGINAL_BACKUP_ENV.telemetryAutoCaptureEnabled;
  }
}

async function withTempConfigFixture(
  run: (fixture: { tempHome: string }) => Promise<void>,
): Promise<void> {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-config-test-"));
  const workspace = path.join(tempHome, "workspace");
  fs.mkdirSync(workspace, { recursive: true });

  process.chdir(workspace);
  process.env.HOME = tempHome;
  clearBackupEnv();

  try {
    await run({ tempHome });
  } finally {
    restoreProcessState();
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

describe("backup settings config", () => {
  test("persists updated backup settings to user config", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();
      const updated = config.updateBackupSettings({
        autoEnabled: true,
        intervalHours: 4,
        retentionCount: 12,
      });

      expect(updated.autoEnabled).toBeTrue();
      expect(updated.intervalHours).toBe(4);
      expect(updated.retentionCount).toBe(12);
      expect(updated.envOverrides.autoEnabled).toBeFalse();
      expect(updated.envOverrides.intervalHours).toBeFalse();
      expect(updated.envOverrides.retentionCount).toBeFalse();

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("backup_auto_enabled = true")).toBeTrue();
      expect(written.includes("backup_interval_hours = 4")).toBeTrue();
      expect(written.includes("backup_retention = 12")).toBeTrue();

      const reloaded = await importConfigModule();
      const persisted = reloaded.getBackupSettings();
      expect(persisted.autoEnabled).toBeTrue();
      expect(persisted.intervalHours).toBe(4);
      expect(persisted.retentionCount).toBe(12);
    });
  });

  test("reports environment overrides while still persisting user values", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      process.env.KANBAN_BACKUP_AUTO_ENABLED = "false";
      process.env.KANBAN_BACKUP_INTERVAL_HOURS = "24";
      process.env.KANBAN_BACKUP_RETENTION = "2";

      const config = await importConfigModule();
      const updated = config.updateBackupSettings({
        autoEnabled: true,
        intervalHours: 6,
        retentionCount: 10,
      });

      expect(updated.autoEnabled).toBeFalse();
      expect(updated.intervalHours).toBe(24);
      expect(updated.retentionCount).toBe(2);
      expect(updated.envOverrides.autoEnabled).toBeTrue();
      expect(updated.envOverrides.intervalHours).toBeTrue();
      expect(updated.envOverrides.retentionCount).toBeTrue();

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("backup_auto_enabled = true")).toBeTrue();
      expect(written.includes("backup_interval_hours = 6")).toBeTrue();
      expect(written.includes("backup_retention = 10")).toBeTrue();
    });
  });
});

describe("thread notification settings config", () => {
  test("defaults to codex parity values and persists updates to user config", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();

      expect(config.getThreadNotificationSettings().turnMode).toBe("unfocused");
      expect(config.getThreadNotificationSettings().permissionsEnabled).toBeTrue();
      expect(config.getThreadNotificationSettings().questionsEnabled).toBeTrue();

      const updated = config.updateThreadNotificationSettings({
        turnMode: "always",
        permissionsEnabled: false,
        questionsEnabled: false,
      });

      expect(updated.turnMode).toBe("always");
      expect(updated.permissionsEnabled).toBeFalse();
      expect(updated.questionsEnabled).toBeFalse();

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("thread_notifications_turn_mode = \"always\"")).toBeTrue();
      expect(written.includes("thread_notifications_permissions_enabled = false")).toBeTrue();
      expect(written.includes("thread_notifications_questions_enabled = false")).toBeTrue();

      const reloaded = await importConfigModule();
      expect(reloaded.getThreadNotificationSettings().turnMode).toBe("always");
      expect(reloaded.getThreadNotificationSettings().permissionsEnabled).toBeFalse();
      expect(reloaded.getThreadNotificationSettings().questionsEnabled).toBeFalse();
    });
  });

  test("reads thread notification settings from user config even when project config exists", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const projectConfigDir = path.join(tempHome, "workspace", ".nodex");
      fs.mkdirSync(projectConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectConfigDir, "config.toml"),
        [
          "[server]",
          "thread_notifications_turn_mode = \"off\"",
          "thread_notifications_permissions_enabled = false",
          "thread_notifications_questions_enabled = false",
          "",
        ].join("\n"),
        "utf8",
      );

      const config = await importConfigModule();
      const updated = config.updateThreadNotificationSettings({
        turnMode: "always",
        permissionsEnabled: true,
        questionsEnabled: true,
      });

      expect(updated.turnMode).toBe("always");
      expect(updated.permissionsEnabled).toBeTrue();
      expect(updated.questionsEnabled).toBeTrue();

      const reloaded = await importConfigModule();
      expect(reloaded.getThreadNotificationSettings().turnMode).toBe("always");
      expect(reloaded.getThreadNotificationSettings().permissionsEnabled).toBeTrue();
      expect(reloaded.getThreadNotificationSettings().questionsEnabled).toBeTrue();
    });
  });
});

describe("app update settings config", () => {
  test("defaults to automatic checks enabled and persists updates to user config", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();

      expect(config.getAppUpdateSettings().automaticChecksEnabled).toBeTrue();

      const updated = config.updateAppUpdateSettings({
        automaticChecksEnabled: false,
      });

      expect(updated.automaticChecksEnabled).toBeFalse();

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("app_updates_auto_check_enabled = false")).toBeTrue();

      const reloaded = await importConfigModule();
      expect(reloaded.getAppUpdateSettings().automaticChecksEnabled).toBeFalse();
    });
  });

  test("reads app update settings from user config even when project config exists", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const projectConfigDir = path.join(tempHome, "workspace", ".nodex");
      fs.mkdirSync(projectConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectConfigDir, "config.toml"),
        ["[server]", "app_updates_auto_check_enabled = true", ""].join("\n"),
        "utf8",
      );

      const config = await importConfigModule();
      const updated = config.updateAppUpdateSettings({
        automaticChecksEnabled: false,
      });

      expect(updated.automaticChecksEnabled).toBeFalse();

      const reloaded = await importConfigModule();
      expect(reloaded.getAppUpdateSettings().automaticChecksEnabled).toBeFalse();
    });
  });
});

describe("window restore settings config", () => {
  test("defaults to restoring all windows and persists updates to user config", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();

      expect(config.getWindowRestoreSettings().policy).toBe("all");

      const updated = config.updateWindowRestoreSettings({
        policy: "last-window",
      });

      expect(updated.policy).toBe("last-window");

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes('window_restore_policy = "last-window"')).toBeTrue();

      const reloaded = await importConfigModule();
      expect(reloaded.getWindowRestoreSettings().policy).toBe("last-window");
    });
  });

  test("rejects invalid window restore policies", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      let threw = false;
      try {
        config.updateWindowRestoreSettings({ policy: "invalid" });
      } catch {
        threw = true;
      }
      expect(threw).toBeTrue();
    });
  });
});

describe("diagnostics settings config", () => {
  test("defaults to disabled diagnostics without using the bundled Sentry DSN", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      const settings = config.getDiagnosticsSettings();

      expect(settings.enabled).toBeFalse();
      expect(settings.dsn).toBe("");
      expect(settings.environment).toBe("production");
      expect(settings.release).toBe(null);
      expect(settings.tracesSampleRate).toBe(0);
      expect(settings.replayEnabled).toBeFalse();
      expect(settings.replaysSessionSampleRate).toBe(0.1);
      expect(settings.replaysOnErrorSampleRate).toBe(1);
      expect(settings.envOverrides.enabled).toBeFalse();
      expect(settings.envOverrides.dsn).toBeFalse();
      expect(settings.envOverrides.environment).toBeFalse();
      expect(settings.envOverrides.release).toBeFalse();
      expect(settings.envOverrides.tracesSampleRate).toBeFalse();
      expect(settings.envOverrides.replayEnabled).toBeFalse();
      expect(settings.envOverrides.replaysSessionSampleRate).toBeFalse();
      expect(settings.envOverrides.replaysOnErrorSampleRate).toBeFalse();
    });
  });

  test("persists diagnostics settings and uses the bundled Sentry DSN when enabled", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();
      const updated = config.updateDiagnosticsSettings({
        enabled: true,
        dsn: "",
        environment: "staging",
        release: "nodex@test",
        tracesSampleRate: 0.2,
        replayEnabled: true,
        replaysSessionSampleRate: 0.4,
        replaysOnErrorSampleRate: 1,
      });

      expect(updated.enabled).toBeTrue();
      expect(updated.dsn).toBe(config.DEFAULT_SENTRY_DSN);
      expect(updated.environment).toBe("staging");
      expect(updated.release).toBe("nodex@test");
      expect(updated.tracesSampleRate).toBe(0.2);
      expect(updated.replayEnabled).toBeTrue();
      expect(updated.replaysSessionSampleRate).toBe(0.4);
      expect(updated.replaysOnErrorSampleRate).toBe(1);

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("diagnostics_enabled = true")).toBeTrue();
      expect(written.includes('diagnostics_environment = "staging"')).toBeTrue();
      expect(written.includes('diagnostics_release = "nodex@test"')).toBeTrue();
      expect(written.includes("diagnostics_traces_sample_rate = 0.2")).toBeTrue();
      expect(written.includes("diagnostics_replay_enabled = true")).toBeTrue();
      expect(written.includes("diagnostics_replays_session_sample_rate = 0.4")).toBeTrue();
      expect(written.includes("diagnostics_replays_on_error_sample_rate = 1")).toBeTrue();
    });
  });

  test("reports diagnostics env overrides while still persisting user values", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      process.env.NODEX_SENTRY_ENABLED = "true";
      process.env.SENTRY_DSN = "https://env.example/1";
      process.env.SENTRY_ENVIRONMENT = "qa";
      process.env.SENTRY_RELEASE = "nodex@env";
      process.env.NODEX_SENTRY_TRACES_SAMPLE_RATE = "0.7";
      process.env.NODEX_SENTRY_REPLAY_ENABLED = "true";
      process.env.NODEX_SENTRY_REPLAYS_SESSION_SAMPLE_RATE = "0.8";
      process.env.NODEX_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE = "0.9";

      const config = await importConfigModule();
      const updated = config.updateDiagnosticsSettings({
        enabled: false,
        dsn: "https://config.example/1",
        environment: "staging",
        release: "nodex@config",
        tracesSampleRate: 0.2,
        replayEnabled: false,
        replaysSessionSampleRate: 0.3,
        replaysOnErrorSampleRate: 0.4,
      });

      expect(updated.enabled).toBeTrue();
      expect(updated.dsn).toBe("https://env.example/1");
      expect(updated.environment).toBe("qa");
      expect(updated.release).toBe("nodex@env");
      expect(updated.tracesSampleRate).toBe(0.7);
      expect(updated.replayEnabled).toBeTrue();
      expect(updated.replaysSessionSampleRate).toBe(0.8);
      expect(updated.replaysOnErrorSampleRate).toBe(0.9);
      expect(updated.envOverrides.enabled).toBeTrue();
      expect(updated.envOverrides.dsn).toBeTrue();
      expect(updated.envOverrides.environment).toBeTrue();
      expect(updated.envOverrides.release).toBeTrue();
      expect(updated.envOverrides.tracesSampleRate).toBeTrue();
      expect(updated.envOverrides.replayEnabled).toBeTrue();
      expect(updated.envOverrides.replaysSessionSampleRate).toBeTrue();
      expect(updated.envOverrides.replaysOnErrorSampleRate).toBeTrue();

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("diagnostics_enabled = false")).toBeTrue();
      expect(written.includes('diagnostics_dsn = "https://config.example/1"')).toBeTrue();
      expect(written.includes('diagnostics_environment = "staging"')).toBeTrue();
      expect(written.includes('diagnostics_release = "nodex@config"')).toBeTrue();
      expect(written.includes("diagnostics_traces_sample_rate = 0.2")).toBeTrue();
      expect(written.includes("diagnostics_replay_enabled = false")).toBeTrue();
      expect(written.includes("diagnostics_replays_session_sample_rate = 0.3")).toBeTrue();
      expect(written.includes("diagnostics_replays_on_error_sample_rate = 0.4")).toBeTrue();
    });
  });

  test("rejects invalid diagnostics replay sample rates", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      let sessionRateThrew = false;
      try {
        config.updateDiagnosticsSettings({
          enabled: true,
          dsn: "",
          environment: "production",
          release: null,
          tracesSampleRate: 0,
          replayEnabled: true,
          replaysSessionSampleRate: 1.1,
          replaysOnErrorSampleRate: 1,
        });
      } catch {
        sessionRateThrew = true;
      }
      expect(sessionRateThrew).toBeTrue();

      let errorRateThrew = false;
      try {
        config.updateDiagnosticsSettings({
          enabled: true,
          dsn: "",
          environment: "production",
          release: null,
          tracesSampleRate: 0,
          replayEnabled: true,
          replaysSessionSampleRate: 0.1,
          replaysOnErrorSampleRate: -0.1,
        });
      } catch {
        errorRateThrew = true;
      }
      expect(errorRateThrew).toBeTrue();
    });
  });
});

describe("telemetry settings config", () => {
  test("defaults to disabled telemetry without using the bundled Statsig key", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      const settings = config.getTelemetrySettings();

      expect(settings.enabled).toBeFalse();
      expect(settings.clientKey).toBe("");
      expect(settings.environment).toBe("production");
      expect(settings.autoCaptureEnabled).toBeFalse();
      expect(settings.envOverrides.enabled).toBeFalse();
      expect(settings.envOverrides.clientKey).toBeFalse();
      expect(settings.envOverrides.environment).toBeFalse();
      expect(settings.envOverrides.autoCaptureEnabled).toBeFalse();
    });
  });

  test("persists telemetry settings and uses the bundled Statsig key when enabled", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();
      const updated = config.updateTelemetrySettings({
        enabled: true,
        clientKey: "",
        environment: "staging",
        autoCaptureEnabled: true,
      });

      expect(updated.enabled).toBeTrue();
      expect(updated.clientKey).toBe(config.DEFAULT_STATSIG_CLIENT_KEY);
      expect(updated.environment).toBe("staging");
      expect(updated.autoCaptureEnabled).toBeTrue();

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("telemetry_enabled = true")).toBeTrue();
      expect(written.includes('telemetry_environment = "staging"')).toBeTrue();
      expect(written.includes("telemetry_auto_capture_enabled = true")).toBeTrue();
    });
  });

  test("reports telemetry env overrides while still persisting user values", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      process.env.NODEX_TELEMETRY_ENABLED = "true";
      process.env.STATSIG_CLIENT_KEY = "client-env";
      process.env.STATSIG_ENVIRONMENT = "qa";
      process.env.NODEX_TELEMETRY_AUTOCAPTURE_ENABLED = "true";

      const config = await importConfigModule();
      const updated = config.updateTelemetrySettings({
        enabled: false,
        clientKey: "client-config",
        environment: "staging",
        autoCaptureEnabled: false,
      });

      expect(updated.enabled).toBeTrue();
      expect(updated.clientKey).toBe("client-env");
      expect(updated.environment).toBe("qa");
      expect(updated.autoCaptureEnabled).toBeTrue();
      expect(updated.envOverrides.enabled).toBeTrue();
      expect(updated.envOverrides.clientKey).toBeTrue();
      expect(updated.envOverrides.environment).toBeTrue();
      expect(updated.envOverrides.autoCaptureEnabled).toBeTrue();

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("telemetry_enabled = false")).toBeTrue();
      expect(written.includes('telemetry_client_key = "client-config"')).toBeTrue();
      expect(written.includes('telemetry_environment = "staging"')).toBeTrue();
      expect(written.includes("telemetry_auto_capture_enabled = false")).toBeTrue();
    });
  });

  test("rejects invalid telemetry settings", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      let enabledThrew = false;
      try {
        config.updateTelemetrySettings({
          enabled: "true",
          clientKey: "",
          environment: "production",
          autoCaptureEnabled: false,
        });
      } catch {
        enabledThrew = true;
      }
      expect(enabledThrew).toBeTrue();

      let autoCaptureThrew = false;
      try {
        config.updateTelemetrySettings({
          enabled: true,
          clientKey: "",
          environment: "production",
          autoCaptureEnabled: "false",
        });
      } catch {
        autoCaptureThrew = true;
      }
      expect(autoCaptureThrew).toBeTrue();
    });
  });
});

describe("history settings config", () => {
  test("persists updated history retention to user config", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();
      const updated = config.updateHistorySettings({
        retentionCount: 250,
      });

      expect(updated.retentionCount).toBe(250);
      expect(updated.envOverrides.retentionCount).toBeFalse();

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("history_retention = 250")).toBeTrue();

      const reloaded = await importConfigModule();
      expect(reloaded.getHistorySettings().retentionCount).toBe(250);
      expect(reloaded.getHistoryRetention()).toBe(250);
    });
  });

  test("reports history retention env override while still persisting user value", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      process.env.KANBAN_HISTORY_RETENTION = "5";

      const config = await importConfigModule();
      const updated = config.updateHistorySettings({
        retentionCount: 250,
      });

      expect(updated.retentionCount).toBe(5);
      expect(updated.envOverrides.retentionCount).toBeTrue();

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("history_retention = 250")).toBeTrue();
    });
  });
});

describe("command keybinding config", () => {
  test("persists custom arrays empty unassigned reset-one and reset-all", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      type TestCommandKeymapEntry = {
        id: string;
        isCustom: boolean;
        keybindings: Array<{ key: string | null }>;
      };
      const config = await importConfigModule();

      const customState = config.updateCommandKeybinding("openThreadInNewWindow", {
        type: "set",
        keybinding: { key: "CmdOrCtrl+Alt+W" },
      });
      const customEntry = (customState.entries as TestCommandKeymapEntry[]).find((entry) => entry.id === "openThreadInNewWindow");
      expect(customEntry?.keybindings[0]?.key).toBe("CmdOrCtrl+Alt+W");
      expect(customEntry?.isCustom).toBeTrue();

      const unassignedState = config.updateCommandKeybinding("openThreadInNewWindow", {
        type: "remove",
        keybinding: { key: "CmdOrCtrl+Alt+W" },
      });
      const unassignedEntry = (unassignedState.entries as TestCommandKeymapEntry[]).find((entry) => entry.id === "openThreadInNewWindow");
      expect(unassignedEntry?.keybindings.length).toBe(0);
      expect(unassignedEntry?.isCustom).toBeTrue();

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("[server.command_keybindings]")).toBeTrue();
      expect(written.includes("openThreadInNewWindow = []")).toBeTrue();

      const resetEntryState = config.updateCommandKeybinding("openThreadInNewWindow", { type: "reset" });
      const resetEntry = (resetEntryState.entries as TestCommandKeymapEntry[]).find((entry) => entry.id === "openThreadInNewWindow");
      expect(resetEntry?.isCustom).toBeFalse();

      config.updateCommandKeybinding("renameThread", {
        type: "set",
        keybinding: { key: "CmdOrCtrl+Alt+Shift+R" },
      });
      const resetAllState = config.resetCommandKeybindings();
      expect(resetAllState.hasCustomBindings).toBeFalse();
      const resetAllWritten = fs.readFileSync(configPath, "utf8");
      expect(resetAllWritten.includes("[server.command_keybindings]")).toBeFalse();
    });
  });

  test("rejects invalid and conflicting accelerators", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();

      let invalidThrew = false;
      try {
        config.updateCommandKeybinding("renameThread", {
          type: "set",
          keybinding: { key: "Command" },
        });
      } catch {
        invalidThrew = true;
      }
      expect(invalidThrew).toBeTrue();

      let conflictThrew = false;
      try {
        config.updateCommandKeybinding("renameThread", {
          type: "set",
          keybinding: { key: "CmdOrCtrl+B" },
        });
      } catch {
        conflictThrew = true;
      }
      expect(conflictThrew).toBeTrue();
    });
  });
});
