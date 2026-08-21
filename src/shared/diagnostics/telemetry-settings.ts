import type { TelemetrySettings, TelemetrySettingsEnvOverrides } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTelemetrySettingsEnvOverrides(
  value: unknown,
): value is TelemetrySettingsEnvOverrides {
  if (!isRecord(value)) return false;

  return (
    typeof value.enabled === "boolean" &&
    typeof value.clientKey === "boolean" &&
    typeof value.environment === "boolean" &&
    typeof value.autoCaptureEnabled === "boolean"
  );
}

export function isTelemetrySettings(value: unknown): value is TelemetrySettings {
  if (!isRecord(value)) return false;

  return (
    typeof value.enabled === "boolean" &&
    typeof value.clientKey === "string" &&
    typeof value.environment === "string" &&
    typeof value.autoCaptureEnabled === "boolean" &&
    isTelemetrySettingsEnvOverrides(value.envOverrides)
  );
}
