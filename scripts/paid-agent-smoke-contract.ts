export const PAID_AGENT_SMOKE_CASES = ["file", "browser", "subagent"] as const;

export type PaidAgentSmokeCase = (typeof PAID_AGENT_SMOKE_CASES)[number];

export interface PaidAgentSmokeCaseDefinition {
  readonly id: PaidAgentSmokeCase;
  readonly grep: string;
  readonly modelId: string;
  readonly reasoningEffort: string;
  readonly maximumAgentExecutions: number;
}

export const PAID_AGENT_SMOKE_DEFINITIONS: Readonly<
  Record<PaidAgentSmokeCase, PaidAgentSmokeCaseDefinition>
> = {
  file: {
    id: "file",
    grep: "@paid-agent-file",
    modelId: "gpt-5.6-luna",
    reasoningEffort: "max",
    maximumAgentExecutions: 1,
  },
  browser: {
    id: "browser",
    grep: "@paid-agent-browser",
    modelId: "gpt-5.6-luna",
    reasoningEffort: "max",
    maximumAgentExecutions: 1,
  },
  subagent: {
    id: "subagent",
    grep: "@paid-agent-subagent",
    modelId: "gpt-5.6-terra",
    reasoningEffort: "medium",
    maximumAgentExecutions: 2,
  },
};

export const isPaidAgentSmokeCase = (value: string): value is PaidAgentSmokeCase =>
  PAID_AGENT_SMOKE_CASES.some((candidate) => candidate === value);

export const requirePaidAgentSmokeCase = (value: string | undefined): PaidAgentSmokeCase => {
  if (value && isPaidAgentSmokeCase(value)) return value;
  throw new Error(
    `Paid Agent smoke case must be one of ${PAID_AGENT_SMOKE_CASES.join(" | ")}; received ${JSON.stringify(value)}.`,
  );
};
