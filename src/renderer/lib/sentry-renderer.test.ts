import { afterEach, describe, expect, test } from "bun:test";
import type { DiagnosticsSettings } from "./types";
import {
  initializeRendererSentry,
  resetRendererSentryForTests,
} from "./sentry-renderer";

function buildSettings(
  enabled: boolean,
  overrides: Partial<DiagnosticsSettings> = {},
): DiagnosticsSettings {
  return {
    enabled,
    dsn: enabled ? "https://example.com/1" : "",
    environment: "test",
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

describe("renderer Sentry diagnostics", () => {
  afterEach(() => {
    delete process.env.NODEX_SENTRY_FORCE_TEST;
    resetRendererSentryForTests();
  });

  test("does not initialize when diagnostics are disabled", async () => {
    process.env.NODEX_SENTRY_FORCE_TEST = "1";
    let initCount = 0;
    const initialized = await initializeRendererSentry({
      getSettings: async () => buildSettings(false),
      adapter: {
        init: () => {
          initCount += 1;
        },
        replayIntegration: () => ({}),
        setTag: () => {},
      },
    });

    expect(initialized).toBeFalse();
    expect(initCount).toBe(0);
  });

  test("does not require the renderer to expose a Node process global", async () => {
    const mutableGlobal = globalThis as unknown as {
      process: typeof process | undefined;
    };
    const originalProcess = mutableGlobal.process;

    try {
      mutableGlobal.process = undefined;

      const initialized = await initializeRendererSentry({
        getSettings: async () => buildSettings(false),
        adapter: {
          init: () => {},
          replayIntegration: () => ({}),
          setTag: () => {},
        },
      });

      expect(initialized).toBeFalse();
    } finally {
      mutableGlobal.process = originalProcess;
    }
  });

  test("tolerates partial renderer process shims", async () => {
    const mutableGlobal = globalThis as unknown as {
      process: unknown;
    };
    const originalProcess = mutableGlobal.process;
    let initCount = 0;

    try {
      mutableGlobal.process = {
        env: { NODEX_SENTRY_FORCE_TEST: "1" },
        argv: "test",
      };

      const initialized = await initializeRendererSentry({
        getSettings: async () => buildSettings(true),
        adapter: {
          init: () => {
            initCount += 1;
          },
          replayIntegration: () => ({}),
          setTag: () => {},
        },
      });

      expect(initialized).toBeTrue();
      expect(initCount).toBe(1);
    } finally {
      mutableGlobal.process = originalProcess;
    }
  });

  test("initializes with privacy defaults when diagnostics are enabled", async () => {
    process.env.NODEX_SENTRY_FORCE_TEST = "1";
    const initOptions: Record<string, unknown>[] = [];
    let processTag = "";
    const initialized = await initializeRendererSentry({
      getSettings: async () => buildSettings(true),
      adapter: {
        init: (options) => {
          initOptions.push(options);
        },
        replayIntegration: () => ({}),
        setTag: (key, value) => {
          if (key === "process") processTag = value;
        },
      },
    });

    expect(initialized).toBeTrue();
    expect(initOptions[0]?.sendDefaultPii).toBeFalse();
    expect(initOptions[0]?.attachScreenshot).toBeFalse();
    expect(initOptions[0]?.integrations).toBe(undefined);
    expect(processTag).toBe("renderer");
  });

  test("adds strict Session Replay integration when replay is enabled", async () => {
    process.env.NODEX_SENTRY_FORCE_TEST = "1";
    const replayToken = { name: "Replay" };
    const initOptions: Record<string, unknown>[] = [];
    const replayOptions: Record<string, unknown>[] = [];
    const initialized = await initializeRendererSentry({
      getSettings: async () =>
        buildSettings(true, {
          replayEnabled: true,
          replaysSessionSampleRate: 0.1,
          replaysOnErrorSampleRate: 1,
        }),
      adapter: {
        init: (options) => {
          initOptions.push(options);
        },
        replayIntegration: (options) => {
          replayOptions.push(options);
          return replayToken;
        },
        setTag: () => {},
      },
    });

    const integrations = initOptions[0]?.integrations as unknown[] | undefined;
    expect(initialized).toBeTrue();
    expect(replayOptions[0]?.maskAllText).toBeTrue();
    expect(replayOptions[0]?.maskAllInputs).toBeTrue();
    expect(replayOptions[0]?.blockAllMedia).toBeTrue();
    expect(integrations?.length).toBe(1);
    expect(integrations?.[0]).toBe(replayToken);
    expect(initOptions[0]?.replaysSessionSampleRate).toBe(0.1);
    expect(initOptions[0]?.replaysOnErrorSampleRate).toBe(1);
  });
});
