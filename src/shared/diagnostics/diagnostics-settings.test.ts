import { describe, expect, test } from "bun:test";
import { isDiagnosticsSettings } from "./diagnostics-settings";

const VALID_SETTINGS = {
  enabled: true,
  dsn: "https://example.com/1",
  environment: "test",
  release: null,
  tracesSampleRate: 0,
  envOverrides: {
    enabled: false,
    dsn: false,
    environment: false,
    release: false,
    tracesSampleRate: false,
  },
};

describe("diagnostics settings guard", () => {
  test("accepts a complete diagnostics settings payload", () => {
    expect(isDiagnosticsSettings(VALID_SETTINGS)).toBeTrue();
  });

  test("rejects incomplete environment override state", () => {
    expect(isDiagnosticsSettings({
      ...VALID_SETTINGS,
      envOverrides: {
        enabled: false,
      },
    })).toBeFalse();
  });

  test("rejects invalid trace sample rates", () => {
    expect(isDiagnosticsSettings({
      ...VALID_SETTINGS,
      tracesSampleRate: Number.POSITIVE_INFINITY,
    })).toBeFalse();

    expect(isDiagnosticsSettings({
      ...VALID_SETTINGS,
      tracesSampleRate: 1.1,
    })).toBeFalse();
  });
});
