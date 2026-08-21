import type { ThreadStartParams } from "@nodex/codex-app-server-protocol/v2/ThreadStartParams";
import { CODEX_CONCURRENT_REASONING_SUMMARIES_FEATURE } from "../../shared/codex-reasoning-summary-policy";

/** Capabilities required by Nodex's live agent transcript and tool surfaces. */
export const CODEX_DEFAULT_FEATURE_OVERRIDES = {
  apply_patch_streaming_events: true,
  [CODEX_CONCURRENT_REASONING_SUMMARIES_FEATURE]: true,
  thread_tools: true,
} as const satisfies Record<string, true>;

export type CodexNodexThreadCapability = keyof typeof CODEX_DEFAULT_FEATURE_OVERRIDES;

export function buildCodexThreadConfigOverrides(): NonNullable<ThreadStartParams["config"]> {
  return Object.fromEntries(
    Object.entries(CODEX_DEFAULT_FEATURE_OVERRIDES).map(([key, value]) => [
      `features.${key}`,
      value,
    ]),
  );
}
