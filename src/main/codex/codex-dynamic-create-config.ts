import type { Config } from "@nodex/codex-app-server-protocol/v2/Config";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Exact bundle `m$e`: overlay non-null values from the selected config profile. */
export function expandCodexDynamicCreateConfigProfile<
  T extends Readonly<Partial<Config>>,
>(config: T): T {
  const record = config as T & {
    readonly profile?: unknown;
    readonly profiles?: unknown;
  };
  if (typeof record.profile !== "string") return config;
  const profiles = asRecord(record.profiles);
  const selected = profiles ? asRecord(profiles[record.profile]) : null;
  if (!selected) return config;

  const expanded = { ...config } as Record<string, unknown>;
  for (const [key, value] of Object.entries(selected)) {
    if (value !== null && value !== undefined) expanded[key] = value;
  }
  return expanded as T;
}
