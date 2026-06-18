import { describe, expect, test } from "bun:test";
import { isTelemetrySettings } from "./telemetry-settings";

const VALID_SETTINGS = {
  enabled: true,
  clientKey: "client-test",
  environment: "test",
  autoCaptureEnabled: true,
  envOverrides: {
    enabled: false,
    clientKey: false,
    environment: false,
    autoCaptureEnabled: false,
  },
};

describe("telemetry settings guard", () => {
  test("accepts a complete telemetry settings payload", () => {
    expect(isTelemetrySettings(VALID_SETTINGS)).toBeTrue();
  });

  test("rejects incomplete environment override state", () => {
    expect(isTelemetrySettings({
      ...VALID_SETTINGS,
      envOverrides: {
        enabled: false,
      },
    })).toBeFalse();
  });

  test("rejects invalid field types", () => {
    expect(isTelemetrySettings({
      ...VALID_SETTINGS,
      clientKey: null,
    })).toBeFalse();

    expect(isTelemetrySettings({
      ...VALID_SETTINGS,
      autoCaptureEnabled: "true",
    })).toBeFalse();
  });
});
