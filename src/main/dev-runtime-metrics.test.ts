import { afterEach, describe, expect, test } from "vitest";
import { subscribeToBackendLogs } from "./logging/logger";
import { isDevRuntimeMetricsEnabled, logDevRuntimeMetric } from "./dev-runtime-metrics";
import { NODEX_DEVELOPMENT_FEATURES_ENV } from "../shared/development-features";

const ORIGINAL_DEVELOPMENT_FEATURES = process.env[NODEX_DEVELOPMENT_FEATURES_ENV];

afterEach(() => {
  if (ORIGINAL_DEVELOPMENT_FEATURES === undefined) {
    delete process.env[NODEX_DEVELOPMENT_FEATURES_ENV];
    return;
  }
  process.env[NODEX_DEVELOPMENT_FEATURES_ENV] = ORIGINAL_DEVELOPMENT_FEATURES;
});

describe("dev runtime metrics", () => {
  test("is disabled by default and honors the canonical development gate", () => {
    delete process.env[NODEX_DEVELOPMENT_FEATURES_ENV];
    expect(isDevRuntimeMetricsEnabled()).toBe(false);

    process.env[NODEX_DEVELOPMENT_FEATURES_ENV] = "runtime-metrics";
    expect(isDevRuntimeMetricsEnabled()).toBe(true);
  });

  test("emits a structured info record only when explicitly enabled", () => {
    const records: Array<Record<string, unknown>> = [];
    const unsubscribe = subscribeToBackendLogs((entry) => records.push(entry), { level: "info" });

    try {
      delete process.env[NODEX_DEVELOPMENT_FEATURES_ENV];
      logDevRuntimeMetric("disabled.metric");

      process.env[NODEX_DEVELOPMENT_FEATURES_ENV] = "runtime-metrics";
      logDevRuntimeMetric("enabled.metric", { durationMs: 12 });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        level: "info",
        msg: "dev runtime metric",
        metric: "enabled.metric",
        durationMs: 12,
      });
    } finally {
      unsubscribe();
    }
  });
});
