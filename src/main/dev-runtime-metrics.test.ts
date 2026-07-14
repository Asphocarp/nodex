import { afterEach, describe, expect, test } from "vitest";
import { subscribeToBackendLogs } from "./logging/logger";
import {
  isDevRuntimeMetricsEnabled,
  logDevRuntimeMetric,
} from "./dev-runtime-metrics";

const ORIGINAL_NODEX_DEV_METRICS = process.env.NODEX_DEV_METRICS;

afterEach(() => {
  if (ORIGINAL_NODEX_DEV_METRICS === undefined) {
    delete process.env.NODEX_DEV_METRICS;
    return;
  }
  process.env.NODEX_DEV_METRICS = ORIGINAL_NODEX_DEV_METRICS;
});

describe("dev runtime metrics", () => {
  test("is disabled by default and honors explicit boolean configuration", () => {
    delete process.env.NODEX_DEV_METRICS;
    expect(isDevRuntimeMetricsEnabled()).toBe(false);

    process.env.NODEX_DEV_METRICS = "true";
    expect(isDevRuntimeMetricsEnabled()).toBe(true);

    process.env.NODEX_DEV_METRICS = "0";
    expect(isDevRuntimeMetricsEnabled()).toBe(false);
  });

  test("emits a structured info record only when explicitly enabled", () => {
    const records: Array<Record<string, unknown>> = [];
    const unsubscribe = subscribeToBackendLogs(
      (entry) => records.push(entry),
      { level: "info" },
    );

    try {
      delete process.env.NODEX_DEV_METRICS;
      logDevRuntimeMetric("disabled.metric");

      process.env.NODEX_DEV_METRICS = "1";
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
