import type { ThreadStartResponse } from "@nodex/codex-app-server-protocol/v2";
import type { AgentExecutionProfile } from "../../shared/agent-runtime";

/** Rejects a provider-side substitution before Nodex admits the first Turn. */
export function requireExactThreadStartProfile(
  response: ThreadStartResponse,
  expected: AgentExecutionProfile | null,
): void {
  if (!expected) return;
  const actual = {
    providerId: response.modelProvider,
    modelId: response.model,
    reasoningEffort: response.reasoningEffort,
    serviceTier: response.serviceTier,
  };
  const mismatches = (Object.keys(actual) as Array<keyof typeof actual>).filter(
    (key) => actual[key] !== expected[key],
  );
  if (mismatches.length === 0) return;
  throw new Error(
    `Agent runtime substituted the requested execution profile: ${mismatches.join(", ")}`,
  );
}
