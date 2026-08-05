import type { ReasoningSummary } from "@nodex/codex-app-server-protocol";

/** The app-server feature that makes readable reasoning summaries available. */
export const CODEX_CONCURRENT_REASONING_SUMMARIES_FEATURE =
  "concurrent_reasoning_summaries" as const;

/** Nodex enables the same Electron capability for every locally launched thread. */
export const CODEX_CONCURRENT_REASONING_SUMMARIES_ENABLED = true as const;

/** Electron resolves this feature to detailed summaries for ordinary turns. */
export const CODEX_DEFAULT_REASONING_SUMMARY: ReasoningSummary = "detailed";

const REASONING_SUMMARIES = new Set<ReasoningSummary>([
  "auto",
  "concise",
  "detailed",
  "none",
]);

export function parseCodexReasoningSummary(value: unknown): ReasoningSummary | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return REASONING_SUMMARIES.has(value as ReasoningSummary)
    ? value as ReasoningSummary
    : undefined;
}

/**
 * Mirrors Electron's turn-start precedence:
 * persisted thread setting, concurrent-summary feature override, then an
 * explicit per-turn override. `null` is represented as the protocol's
 * `none` mode because the request must carry a concrete summary policy.
 */
export function resolveCodexReasoningSummary(input: {
  configuredSummary?: ReasoningSummary | null;
  explicitSummary?: ReasoningSummary | null;
  concurrentReasoningSummaries?: boolean;
} = {}): ReasoningSummary {
  let summary = input.configuredSummary ?? "none";
  if (input.concurrentReasoningSummaries ?? CODEX_CONCURRENT_REASONING_SUMMARIES_ENABLED) {
    summary = CODEX_DEFAULT_REASONING_SUMMARY;
  }
  if (input.explicitSummary !== undefined) {
    summary = input.explicitSummary ?? "none";
  }
  return summary;
}
