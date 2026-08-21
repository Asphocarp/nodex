import { describe, expect, test } from "vitest";
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
    expect(isTelemetrySettings(VALID_SETTINGS)).toBe(true);
  });

  test("rejects incomplete environment override state", () => {
    expect(
      isTelemetrySettings({
        ...VALID_SETTINGS,
        envOverrides: {
          enabled: false,
        },
      }),
    ).toBe(false);
  });

  test("rejects invalid field types", () => {
    expect(
      isTelemetrySettings({
        ...VALID_SETTINGS,
        clientKey: null,
      }),
    ).toBe(false);

    expect(
      isTelemetrySettings({
        ...VALID_SETTINGS,
        autoCaptureEnabled: "true",
      }),
    ).toBe(false);
  });
});
