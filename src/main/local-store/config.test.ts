import { describe, expect, test, vi } from "vite-plus/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_NODEX_HOME = process.env.NODEX_HOME;
const ORIGINAL_BACKUP_ENV = {
  autoEnabled: process.env.NODEX_BACKUP_AUTO_ENABLED,
  intervalHours: process.env.NODEX_BACKUP_INTERVAL_HOURS,
  retention: process.env.NODEX_BACKUP_RETENTION,
  historyRetention: process.env.NODEX_HISTORY_RETENTION,
  sentryEnabled: process.env.NODEX_SENTRY_ENABLED,
  sentryDsn: process.env.SENTRY_DSN,
  sentryEnvironment: process.env.SENTRY_ENVIRONMENT,
  sentryRelease: process.env.SENTRY_RELEASE,
  sentryTracesSampleRate: process.env.NODEX_SENTRY_TRACES_SAMPLE_RATE,
  sentryReplayEnabled: process.env.NODEX_SENTRY_REPLAY_ENABLED,
  sentryReplaysSessionSampleRate: process.env.NODEX_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
  sentryReplaysOnErrorSampleRate: process.env.NODEX_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
  telemetryEnabled: process.env.NODEX_TELEMETRY_ENABLED,
  statsigClientKey: process.env.STATSIG_CLIENT_KEY,
  statsigEnvironment: process.env.STATSIG_ENVIRONMENT,
  telemetryAutoCaptureEnabled: process.env.NODEX_TELEMETRY_AUTOCAPTURE_ENABLED,
};

async function importConfigModule() {
  vi.resetModules();
  return import("./config");
}

function clearBackupEnv(): void {
  delete process.env.NODEX_HOME;
  delete process.env.NODEX_BACKUP_AUTO_ENABLED;
  delete process.env.NODEX_BACKUP_INTERVAL_HOURS;
  delete process.env.NODEX_BACKUP_RETENTION;
  delete process.env.NODEX_HISTORY_RETENTION;
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

  if (ORIGINAL_NODEX_HOME === undefined) {
    delete process.env.NODEX_HOME;
  } else {
    process.env.NODEX_HOME = ORIGINAL_NODEX_HOME;
  }

  if (ORIGINAL_BACKUP_ENV.autoEnabled === undefined) {
    delete process.env.NODEX_BACKUP_AUTO_ENABLED;
  } else {
    process.env.NODEX_BACKUP_AUTO_ENABLED = ORIGINAL_BACKUP_ENV.autoEnabled;
  }
  if (ORIGINAL_BACKUP_ENV.intervalHours === undefined) {
    delete process.env.NODEX_BACKUP_INTERVAL_HOURS;
  } else {
    process.env.NODEX_BACKUP_INTERVAL_HOURS = ORIGINAL_BACKUP_ENV.intervalHours;
  }
  if (ORIGINAL_BACKUP_ENV.retention === undefined) {
    delete process.env.NODEX_BACKUP_RETENTION;
  } else {
    process.env.NODEX_BACKUP_RETENTION = ORIGINAL_BACKUP_ENV.retention;
  }
  if (ORIGINAL_BACKUP_ENV.historyRetention === undefined) {
    delete process.env.NODEX_HISTORY_RETENTION;
  } else {
    process.env.NODEX_HISTORY_RETENTION = ORIGINAL_BACKUP_ENV.historyRetention;
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

describe("Nodex home config", () => {
  test("prefers NODEX_HOME over TOML configuration", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const configuredHome = path.join(tempHome, "configured-home");
      const environmentHome = path.join(tempHome, "environment-home");
      const configDirectory = path.join(tempHome, ".nodex");
      fs.mkdirSync(configDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(configDirectory, "config.toml"),
        ["[server]", `home = "${configuredHome}"`, ""].join("\n"),
        "utf8",
      );
      process.env.NODEX_HOME = environmentHome;

      const config = await importConfigModule();

      expect(config.getNodexHome()).toBe(environmentHome);
      expect(config.getDatabasePath()).toBe(path.join(environmentHome, "nodex.db"));
    });
  });

  test("resolves the merged project home relative to the process cwd", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const userConfigDirectory = path.join(tempHome, ".nodex");
      const projectConfigDirectory = path.join(tempHome, "workspace", ".nodex");
      fs.mkdirSync(userConfigDirectory, { recursive: true });
      fs.mkdirSync(projectConfigDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(userConfigDirectory, "config.toml"),
        ["[server]", 'home = "~/user-home"', ""].join("\n"),
        "utf8",
      );
      fs.writeFileSync(
        path.join(projectConfigDirectory, "config.toml"),
        ["[server]", 'home = "project-home"', ""].join("\n"),
        "utf8",
      );

      const config = await importConfigModule();

      expect(config.getNodexHome()).toBe(path.join(process.cwd(), "project-home"));
    });
  });
});

describe("backup settings config", () => {
  test("keeps explicit settings sources isolated and observes external updates", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-config-sources-"));
    const firstHome = path.join(fixtureRoot, "first");
    const secondHome = path.join(fixtureRoot, "second");
    const workspace = path.join(fixtureRoot, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const config = await importConfigModule();
    const firstSource = { cwd: workspace, environment: {}, userHome: firstHome };
    const secondSource = { cwd: workspace, environment: {}, userHome: secondHome };

    try {
      config.updateBackupSettings(
        { autoEnabled: true, intervalHours: 2, retentionCount: 7 },
        firstSource,
      );
      config.updateBackupSettings(
        { autoEnabled: false, intervalHours: 8, retentionCount: 21 },
        secondSource,
      );

      expect(config.getBackupSettings(firstSource).retentionCount).toBe(7);
      expect(config.getBackupSettings(secondSource).retentionCount).toBe(21);

      const firstConfigPath = path.join(firstHome, ".nodex", "config.toml");
      fs.writeFileSync(
        firstConfigPath,
        fs
          .readFileSync(firstConfigPath, "utf8")
          .replace("backup_retention = 7", "backup_retention = 9"),
        "utf8",
      );
      expect(config.getBackupSettings(firstSource).retentionCount).toBe(9);
      expect(fs.readdirSync(path.dirname(firstConfigPath))).toEqual(["config.toml"]);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("persists updated backup settings to user config", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();
      const updated = config.updateBackupSettings({
        autoEnabled: true,
        intervalHours: 4,
        retentionCount: 12,
      });

      expect(updated.autoEnabled).toBe(true);
      expect(updated.intervalHours).toBe(4);
      expect(updated.retentionCount).toBe(12);
      expect(updated.envOverrides.autoEnabled).toBe(false);
      expect(updated.envOverrides.intervalHours).toBe(false);
      expect(updated.envOverrides.retentionCount).toBe(false);

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("backup_auto_enabled = true")).toBe(true);
      expect(written.includes("backup_interval_hours = 4")).toBe(true);
      expect(written.includes("backup_retention = 12")).toBe(true);

      const reloaded = await importConfigModule();
      const persisted = reloaded.getBackupSettings();
      expect(persisted.autoEnabled).toBe(true);
      expect(persisted.intervalHours).toBe(4);
      expect(persisted.retentionCount).toBe(12);
    });
  });

  test("reports environment overrides while still persisting user values", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      process.env.NODEX_BACKUP_AUTO_ENABLED = "false";
      process.env.NODEX_BACKUP_INTERVAL_HOURS = "24";
      process.env.NODEX_BACKUP_RETENTION = "2";

      const config = await importConfigModule();
      const updated = config.updateBackupSettings({
        autoEnabled: true,
        intervalHours: 6,
        retentionCount: 10,
      });

      expect(updated.autoEnabled).toBe(false);
      expect(updated.intervalHours).toBe(24);
      expect(updated.retentionCount).toBe(2);
      expect(updated.envOverrides.autoEnabled).toBe(true);
      expect(updated.envOverrides.intervalHours).toBe(true);
      expect(updated.envOverrides.retentionCount).toBe(true);

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("backup_auto_enabled = true")).toBe(true);
      expect(written.includes("backup_interval_hours = 6")).toBe(true);
      expect(written.includes("backup_retention = 10")).toBe(true);
    });
  });
});

describe("thread notification settings config", () => {
  test("defaults to codex parity values and persists updates to user config", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();

      expect(config.getThreadNotificationSettings().turnMode).toBe("unfocused");
      expect(config.getThreadNotificationSettings().permissionsEnabled).toBe(true);
      expect(config.getThreadNotificationSettings().questionsEnabled).toBe(true);

      const updated = config.updateThreadNotificationSettings({
        turnMode: "always",
        permissionsEnabled: false,
        questionsEnabled: false,
      });

      expect(updated.turnMode).toBe("always");
      expect(updated.permissionsEnabled).toBe(false);
      expect(updated.questionsEnabled).toBe(false);

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes('thread_notifications_turn_mode = "always"')).toBe(true);
      expect(written.includes("thread_notifications_permissions_enabled = false")).toBe(true);
      expect(written.includes("thread_notifications_questions_enabled = false")).toBe(true);

      const reloaded = await importConfigModule();
      expect(reloaded.getThreadNotificationSettings().turnMode).toBe("always");
      expect(reloaded.getThreadNotificationSettings().permissionsEnabled).toBe(false);
      expect(reloaded.getThreadNotificationSettings().questionsEnabled).toBe(false);
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
          'thread_notifications_turn_mode = "off"',
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
      expect(updated.permissionsEnabled).toBe(true);
      expect(updated.questionsEnabled).toBe(true);

      const reloaded = await importConfigModule();
      expect(reloaded.getThreadNotificationSettings().turnMode).toBe("always");
      expect(reloaded.getThreadNotificationSettings().permissionsEnabled).toBe(true);
      expect(reloaded.getThreadNotificationSettings().questionsEnabled).toBe(true);
    });
  });
});

describe("app update settings config", () => {
  test("defaults to automatic checks enabled and persists updates to user config", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();

      expect(config.getAppUpdateSettings().automaticChecksEnabled).toBe(true);
      expect(config.getAppUpdateSettings("nightly").channel).toBe("nightly");

      const updated = config.updateAppUpdateSettings({
        automaticChecksEnabled: false,
        channel: "nightly",
      });

      expect(updated.automaticChecksEnabled).toBe(false);
      expect(updated.channel).toBe("nightly");

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("app_updates_auto_check_enabled = false")).toBe(true);
      expect(written.includes('app_updates_channel = "nightly"')).toBe(true);

      const reloaded = await importConfigModule();
      expect(reloaded.getAppUpdateSettings().automaticChecksEnabled).toBe(false);
      expect(reloaded.getAppUpdateSettings().channel).toBe("nightly");
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

      expect(updated.automaticChecksEnabled).toBe(false);

      const reloaded = await importConfigModule();
      expect(reloaded.getAppUpdateSettings().automaticChecksEnabled).toBe(false);
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
      expect(written.includes('window_restore_policy = "last-window"')).toBe(true);

      const reloaded = await importConfigModule();
      expect(reloaded.getWindowRestoreSettings().policy).toBe("last-window");
    });
  });

  test("rejects invalid window restore policies", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      let threw = false;
      try {
        config.updateWindowRestoreSettings({ policy: "invalid" as never });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });
});

describe("diagnostics settings config", () => {
  test("defaults to disabled diagnostics without using the bundled Sentry DSN", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      const settings = config.getDiagnosticsSettings();

      expect(settings.enabled).toBe(false);
      expect(settings.dsn).toBe("");
      expect(settings.environment).toBe("production");
      expect(settings.release).toBe(null);
      expect(settings.tracesSampleRate).toBe(0);
      expect(settings.replayEnabled).toBe(false);
      expect(settings.replaysSessionSampleRate).toBe(0.1);
      expect(settings.replaysOnErrorSampleRate).toBe(1);
      expect(settings.envOverrides.enabled).toBe(false);
      expect(settings.envOverrides.dsn).toBe(false);
      expect(settings.envOverrides.environment).toBe(false);
      expect(settings.envOverrides.release).toBe(false);
      expect(settings.envOverrides.tracesSampleRate).toBe(false);
      expect(settings.envOverrides.replayEnabled).toBe(false);
      expect(settings.envOverrides.replaysSessionSampleRate).toBe(false);
      expect(settings.envOverrides.replaysOnErrorSampleRate).toBe(false);
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

      expect(updated.enabled).toBe(true);
      expect(updated.dsn).toBe(config.DEFAULT_SENTRY_DSN);
      expect(updated.environment).toBe("staging");
      expect(updated.release).toBe("nodex@test");
      expect(updated.tracesSampleRate).toBe(0.2);
      expect(updated.replayEnabled).toBe(true);
      expect(updated.replaysSessionSampleRate).toBe(0.4);
      expect(updated.replaysOnErrorSampleRate).toBe(1);

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("diagnostics_enabled = true")).toBe(true);
      expect(written.includes('diagnostics_environment = "staging"')).toBe(true);
      expect(written.includes('diagnostics_release = "nodex@test"')).toBe(true);
      expect(written.includes("diagnostics_traces_sample_rate = 0.2")).toBe(true);
      expect(written.includes("diagnostics_replay_enabled = true")).toBe(true);
      expect(written.includes("diagnostics_replays_session_sample_rate = 0.4")).toBe(true);
      expect(written.includes("diagnostics_replays_on_error_sample_rate = 1")).toBe(true);
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

      expect(updated.enabled).toBe(true);
      expect(updated.dsn).toBe("https://env.example/1");
      expect(updated.environment).toBe("qa");
      expect(updated.release).toBe("nodex@env");
      expect(updated.tracesSampleRate).toBe(0.7);
      expect(updated.replayEnabled).toBe(true);
      expect(updated.replaysSessionSampleRate).toBe(0.8);
      expect(updated.replaysOnErrorSampleRate).toBe(0.9);
      expect(updated.envOverrides.enabled).toBe(true);
      expect(updated.envOverrides.dsn).toBe(true);
      expect(updated.envOverrides.environment).toBe(true);
      expect(updated.envOverrides.release).toBe(true);
      expect(updated.envOverrides.tracesSampleRate).toBe(true);
      expect(updated.envOverrides.replayEnabled).toBe(true);
      expect(updated.envOverrides.replaysSessionSampleRate).toBe(true);
      expect(updated.envOverrides.replaysOnErrorSampleRate).toBe(true);

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("diagnostics_enabled = false")).toBe(true);
      expect(written.includes('diagnostics_dsn = "https://config.example/1"')).toBe(true);
      expect(written.includes('diagnostics_environment = "staging"')).toBe(true);
      expect(written.includes('diagnostics_release = "nodex@config"')).toBe(true);
      expect(written.includes("diagnostics_traces_sample_rate = 0.2")).toBe(true);
      expect(written.includes("diagnostics_replay_enabled = false")).toBe(true);
      expect(written.includes("diagnostics_replays_session_sample_rate = 0.3")).toBe(true);
      expect(written.includes("diagnostics_replays_on_error_sample_rate = 0.4")).toBe(true);
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
      expect(sessionRateThrew).toBe(true);

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
      expect(errorRateThrew).toBe(true);
    });
  });
});

describe("telemetry settings config", () => {
  test("defaults to disabled telemetry without using the bundled Statsig key", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      const settings = config.getTelemetrySettings();

      expect(settings.enabled).toBe(false);
      expect(settings.clientKey).toBe("");
      expect(settings.environment).toBe("production");
      expect(settings.autoCaptureEnabled).toBe(false);
      expect(settings.envOverrides.enabled).toBe(false);
      expect(settings.envOverrides.clientKey).toBe(false);
      expect(settings.envOverrides.environment).toBe(false);
      expect(settings.envOverrides.autoCaptureEnabled).toBe(false);
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

      expect(updated.enabled).toBe(true);
      expect(updated.clientKey).toBe(config.DEFAULT_STATSIG_CLIENT_KEY);
      expect(updated.environment).toBe("staging");
      expect(updated.autoCaptureEnabled).toBe(true);

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("telemetry_enabled = true")).toBe(true);
      expect(written.includes('telemetry_environment = "staging"')).toBe(true);
      expect(written.includes("telemetry_auto_capture_enabled = true")).toBe(true);
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

      expect(updated.enabled).toBe(true);
      expect(updated.clientKey).toBe("client-env");
      expect(updated.environment).toBe("qa");
      expect(updated.autoCaptureEnabled).toBe(true);
      expect(updated.envOverrides.enabled).toBe(true);
      expect(updated.envOverrides.clientKey).toBe(true);
      expect(updated.envOverrides.environment).toBe(true);
      expect(updated.envOverrides.autoCaptureEnabled).toBe(true);

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("telemetry_enabled = false")).toBe(true);
      expect(written.includes('telemetry_client_key = "client-config"')).toBe(true);
      expect(written.includes('telemetry_environment = "staging"')).toBe(true);
      expect(written.includes("telemetry_auto_capture_enabled = false")).toBe(true);
    });
  });

  test("rejects invalid telemetry settings", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      let enabledThrew = false;
      try {
        config.updateTelemetrySettings({
          enabled: "true" as never,
          clientKey: "",
          environment: "production",
          autoCaptureEnabled: false,
        });
      } catch {
        enabledThrew = true;
      }
      expect(enabledThrew).toBe(true);

      let autoCaptureThrew = false;
      try {
        config.updateTelemetrySettings({
          enabled: true,
          clientKey: "",
          environment: "production",
          autoCaptureEnabled: "false" as never,
        });
      } catch {
        autoCaptureThrew = true;
      }
      expect(autoCaptureThrew).toBe(true);
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
      expect(updated.envOverrides.retentionCount).toBe(false);

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("history_retention = 250")).toBe(true);

      const reloaded = await importConfigModule();
      expect(reloaded.getHistorySettings().retentionCount).toBe(250);
      expect(reloaded.getHistoryRetention()).toBe(250);
    });
  });

  test("reports history retention env override while still persisting user value", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      process.env.NODEX_HISTORY_RETENTION = "5";

      const config = await importConfigModule();
      const updated = config.updateHistorySettings({
        retentionCount: 250,
      });

      expect(updated.retentionCount).toBe(5);
      expect(updated.envOverrides.retentionCount).toBe(true);

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("history_retention = 250")).toBe(true);
    });
  });
});

describe("Codex developer instruction settings config", () => {
  test("persists the prose detail mode used by main-process launch instructions", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();
      expect(config.getCodexDeveloperInstructionSettings().detailLevel).toBe("STEPS_COMMANDS");

      const updated = config.updateCodexDeveloperInstructionSettings({
        detailLevel: "STEPS_PROSE",
      });
      expect(updated.detailLevel).toBe("STEPS_PROSE");

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes('codex_thread_detail_level = "STEPS_PROSE"')).toBe(true);

      const reloaded = await importConfigModule();
      expect(reloaded.getCodexDeveloperInstructionSettings().detailLevel).toBe("STEPS_PROSE");
    });
  });

  test("rejects invalid detail modes", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      let message = "";
      try {
        config.updateCodexDeveloperInstructionSettings({
          detailLevel: "invalid",
        } as never);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.includes("detailLevel must be one of")).toBe(true);
    });
  });
});

describe("Codex Git settings config", () => {
  test("persists exact Git instruction values and merges field updates", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();
      expect(config.getCodexGitSettings().branchPrefix).toBe("codex/");
      expect(config.getCodexGitSettings().commitInstructions).toBe("");
      expect(config.getCodexGitSettings().pullRequestInstructions).toBe("");

      config.updateCodexGitSettings({ branchPrefix: "team/" });
      config.updateCodexGitSettings({ commitInstructions: "Keep commits focused." });
      const updated = config.updateCodexGitSettings({
        pullRequestInstructions: "Include validation notes.",
      });
      expect(updated.branchPrefix).toBe("team/");
      expect(updated.commitInstructions).toBe("Keep commits focused.");
      expect(updated.pullRequestInstructions).toBe("Include validation notes.");

      const written = fs.readFileSync(path.join(tempHome, ".nodex", "config.toml"), "utf8");
      expect(written.includes('git_branch_prefix = "team/"')).toBe(true);
      expect(written.includes('git_commit_instructions = "Keep commits focused."')).toBe(true);
      expect(written.includes('git_pr_instructions = "Include validation notes."')).toBe(true);

      const reloaded = await importConfigModule();
      expect(reloaded.getCodexGitSettings().branchPrefix).toBe("team/");
      expect(reloaded.getCodexGitSettings().commitInstructions).toBe("Keep commits focused.");
      expect(reloaded.getCodexGitSettings().pullRequestInstructions).toBe(
        "Include validation notes.",
      );
    });
  });
});

describe("managed worktree settings config", () => {
  test("uses safe defaults and persists partial updates without resetting saved values", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();
      expect(config.getManagedWorktreeSettings()).toEqual({
        worktreeRoot: null,
        autoDeleteEnabled: true,
        autoDeleteLimit: 15,
      });

      const customRoot = path.join(tempHome, "managed worktrees");
      config.updateManagedWorktreeSettings({ worktreeRoot: customRoot });
      config.updateManagedWorktreeSettings({ worktreeRoot: path.join(tempHome, "next root") });
      expect(config.getKnownManagedWorktreeRoots()).toContain(path.resolve(customRoot));
      config.updateManagedWorktreeSettings({ worktreeRoot: customRoot });
      config.updateManagedWorktreeSettings({ autoDeleteEnabled: false });
      const updated = config.updateManagedWorktreeSettings({ autoDeleteLimit: 23 });
      expect(updated).toEqual({
        worktreeRoot: path.resolve(customRoot),
        autoDeleteEnabled: false,
        autoDeleteLimit: 23,
      });

      const reloaded = await importConfigModule();
      expect(reloaded.getManagedWorktreeSettings()).toEqual(updated);
    });
  });

  test("normalizes blank roots and rejects invalid or unknown updates", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      config.updateManagedWorktreeSettings({ worktreeRoot: "  ./custom-root  " });
      expect(config.getManagedWorktreeSettings().worktreeRoot).toBe(path.resolve("./custom-root"));
      expect(config.updateManagedWorktreeSettings({ worktreeRoot: "  " }).worktreeRoot).toBeNull();

      expect(() => config.updateManagedWorktreeSettings({ autoDeleteLimit: 0 })).toThrow(
        "autoDeleteLimit must be an integer of at least one",
      );
      expect(() => config.updateManagedWorktreeSettings({ autoDeleteLimit: 1.5 })).toThrow(
        "autoDeleteLimit must be an integer of at least one",
      );
      expect(() => config.updateManagedWorktreeSettings({ surprise: true } as never)).toThrow(
        "Unknown managed worktree setting",
      );
    });
  });
});

describe("SSH execution host settings config", () => {
  test("persists only validated non-secret host connection metadata", async () => {
    await withTempConfigFixture(async ({ tempHome }) => {
      const config = await importConfigModule();
      expect(config.getCodexExecutionHostSettings()).toEqual({ sshHosts: [] });
      const updated = config.updateCodexExecutionHostSettings({
        sshHosts: [
          {
            id: "ssh:build",
            displayName: "Build Mac",
            kind: "ssh",
            sshAlias: "build-mac",
            port: 2202,
            managedRoot: "/Users/build/.nodex/worktrees",
            repositoryRoots: ["/Users/build/src/project"],
            codexBinary: "/Users/build/bin/codex",
            codexHome: "/Users/build/.codex",
            enabled: true,
          },
        ],
      });
      expect(updated.sshHosts).toHaveLength(1);
      expect(updated.sshHosts[0]?.sshAlias).toBe("build-mac");

      const persisted = fs.readFileSync(path.join(tempHome, ".nodex", "config.toml"), "utf8");
      expect(persisted).toContain("execution_hosts");
      expect(persisted).not.toMatch(/private.key|password|identity_file/iu);
      expect((await importConfigModule()).getCodexExecutionHostSettings()).toEqual(updated);
    });
  });

  test("rejects duplicate host identities and SSH option injection", async () => {
    await withTempConfigFixture(async () => {
      const config = await importConfigModule();
      const host = {
        id: "ssh:build",
        displayName: "Build Mac",
        kind: "ssh" as const,
        sshAlias: "build-mac",
        port: null,
        managedRoot: "/tmp/worktrees",
        repositoryRoots: ["/tmp/repo"],
        codexBinary: null,
        codexHome: null,
        enabled: true,
      };
      expect(() => config.updateCodexExecutionHostSettings({ sshHosts: [host, host] })).toThrow(
        "Duplicate SSH execution host id",
      );
      expect(() =>
        config.updateCodexExecutionHostSettings({
          sshHosts: [{ ...host, sshAlias: "-oProxyCommand=bad" }],
        }),
      ).toThrow("SSH alias is invalid");
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
      const customEntry = (customState.entries as TestCommandKeymapEntry[]).find(
        (entry) => entry.id === "openThreadInNewWindow",
      );
      expect(customEntry?.keybindings[0]?.key).toBe("CmdOrCtrl+Alt+W");
      expect(customEntry?.isCustom).toBe(true);

      const unassignedState = config.updateCommandKeybinding("openThreadInNewWindow", {
        type: "remove",
        keybinding: { key: "CmdOrCtrl+Alt+W" },
      });
      const unassignedEntry = (unassignedState.entries as TestCommandKeymapEntry[]).find(
        (entry) => entry.id === "openThreadInNewWindow",
      );
      expect(unassignedEntry?.keybindings.length).toBe(0);
      expect(unassignedEntry?.isCustom).toBe(true);

      const configPath = path.join(tempHome, ".nodex", "config.toml");
      const written = fs.readFileSync(configPath, "utf8");
      expect(written.includes("[server.command_keybindings]")).toBe(true);
      expect(written.includes("openThreadInNewWindow = []")).toBe(true);

      const resetEntryState = config.updateCommandKeybinding("openThreadInNewWindow", {
        type: "reset",
      });
      const resetEntry = (resetEntryState.entries as TestCommandKeymapEntry[]).find(
        (entry) => entry.id === "openThreadInNewWindow",
      );
      expect(resetEntry?.isCustom).toBe(false);

      config.updateCommandKeybinding("renameThread", {
        type: "set",
        keybinding: { key: "CmdOrCtrl+Alt+Shift+R" },
      });
      const resetAllState = config.resetCommandKeybindings();
      expect(resetAllState.hasCustomBindings).toBe(false);
      const resetAllWritten = fs.readFileSync(configPath, "utf8");
      expect(resetAllWritten.includes("[server.command_keybindings]")).toBe(false);
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
      expect(invalidThrew).toBe(true);

      let conflictThrew = false;
      try {
        config.updateCommandKeybinding("renameThread", {
          type: "set",
          keybinding: { key: "CmdOrCtrl+B" },
        });
      } catch {
        conflictThrew = true;
      }
      expect(conflictThrew).toBe(true);
    });
  });
});
