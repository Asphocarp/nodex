import { performance } from "node:perf_hooks";
import { getLogger } from "./logging/logger";

type DevRuntimeMetricFields = Record<string, unknown>;

const devRuntimeMetricLogger = getLogger({
  subsystem: "diagnostics",
  component: "dev-runtime-metrics",
});

const FALSE_VALUES = new Set(["0", "false", "off", "no"]);
const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

export function isDevRuntimeMetricsEnabled(): boolean {
  const explicit = parseBooleanEnv(process.env.NODEX_DEV_METRICS);
  if (explicit !== null) return explicit;
  if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") return false;
  return process.env.NODEX_INTERNAL_APP_PACKAGED !== "1";
}

export function getDevRuntimeMetricStart(): number {
  return performance.now();
}

export function getDevRuntimeMetricDurationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function approximateJsonPayloadBytes(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return null;
  }
}

export function logDevRuntimeMetric(
  metric: string,
  fields: DevRuntimeMetricFields = {},
): void {
  if (!isDevRuntimeMetricsEnabled()) return;
  devRuntimeMetricLogger.info("dev runtime metric", {
    metric,
    ...fields,
  });
}

type CounterBucket = {
  count: number;
  firstAt: number;
  lastAt: number;
  groupedFields: DevRuntimeMetricFields;
  firstFields: DevRuntimeMetricFields;
  lastFields: DevRuntimeMetricFields;
  timer: ReturnType<typeof setTimeout>;
};

const counterBuckets = new Map<string, CounterBucket>();

function pickFields(
  fields: DevRuntimeMetricFields,
  fieldNames: readonly string[],
): DevRuntimeMetricFields {
  const picked: DevRuntimeMetricFields = {};
  for (const fieldName of fieldNames) {
    if (Object.prototype.hasOwnProperty.call(fields, fieldName)) {
      picked[fieldName] = fields[fieldName];
    }
  }
  return picked;
}

function stableCounterKey(metric: string, fields: DevRuntimeMetricFields): string {
  const sortedEntries = Object.entries(fields).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([metric, sortedEntries]);
}

export function recordDevRuntimeMetricCounter(
  metric: string,
  fields: DevRuntimeMetricFields = {},
  options: {
    groupBy?: readonly string[];
    windowMs?: number;
  } = {},
): void {
  if (!isDevRuntimeMetricsEnabled()) return;

  const groupedFields = options.groupBy ? pickFields(fields, options.groupBy) : {};
  const key = stableCounterKey(metric, groupedFields);
  const now = Date.now();
  const existing = counterBuckets.get(key);
  if (existing) {
    existing.count += 1;
    existing.lastAt = now;
    existing.lastFields = fields;
    return;
  }

  const windowMs = Math.max(1, Math.floor(options.windowMs ?? 1_000));
  const timer = setTimeout(() => {
    const bucket = counterBuckets.get(key);
    if (!bucket) return;
    counterBuckets.delete(key);
    logDevRuntimeMetric(metric, {
      ...bucket.groupedFields,
      count: bucket.count,
      windowMs,
      firstAt: bucket.firstAt,
      lastAt: bucket.lastAt,
      firstFields: bucket.firstFields,
      lastFields: bucket.lastFields,
    });
  }, windowMs);
  if (
    typeof timer === "object"
    && timer !== null
    && "unref" in timer
    && typeof timer.unref === "function"
  ) {
    timer.unref();
  }

  counterBuckets.set(key, {
    count: 1,
    firstAt: now,
    lastAt: now,
    groupedFields,
    firstFields: fields,
    lastFields: fields,
    timer,
  });
}
