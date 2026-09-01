import type { ThreadStartResponse } from "@nodex/codex-app-server-protocol/v2";
import type { AgentExecutionProfile } from "../../shared/agent-runtime";
import { normalizeCodexServiceTier } from "../../shared/codex-service-tier";

type ThreadExecutionProfileResponse = Pick<
  ThreadStartResponse,
  "model" | "modelProvider" | "reasoningEffort" | "serviceTier"
>;

/** Rejects a provider-side substitution before Nodex admits the first Turn. */
export function requireExactThreadStartProfile(
  response: ThreadExecutionProfileResponse,
  expected: AgentExecutionProfile | null,
): void {
  if (!expected) return;
  const actual = {
    providerId: response.modelProvider,
    modelId: response.model,
    reasoningEffort: response.reasoningEffort,
    serviceTier: normalizeCodexServiceTier(response.serviceTier),
  };
  const mismatches = (Object.keys(actual) as Array<keyof typeof actual>).filter(
    (key) => actual[key] !== expected[key],
  );
  if (mismatches.length === 0) return;
  throw new Error(
    `Agent runtime substituted the requested execution profile (${mismatches.join(", ")}): expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
  );
}
