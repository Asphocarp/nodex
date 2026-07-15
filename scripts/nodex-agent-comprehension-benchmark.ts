import { z } from "zod";
import { NODEX_AGENT_TOOL_CONTRACTS } from "../src/shared/nodex-agent-tools/contracts";
import { NODEX_AGENT_V3_TOOL_CONTRACTS } from "../src/shared/nodex-agent-tools/v3-contracts";
import {
  NODEX_APP_V2_TOOLS,
  NODEX_APP_V2_TOOLSET_REVISION,
  NODEX_APP_TOOLSET_REVISION,
  NODEX_APP_V3_TOOLS,
  NODEX_APP_V3_TOOLSET_REVISION,
} from "../src/shared/nodex-agent-tools/identity";

export interface NodexAgentComprehensionCase {
  readonly id: string;
  readonly prompt: string;
  readonly expectedTool: Readonly<Record<number, string>>;
}

export const NODEX_AGENT_COMPREHENSION_CASES: readonly NodexAgentComprehensionCase[] = [
  {
    id: "fuzzy-search",
    prompt: "Find the Card whose title is approximately 'dynmic tools'.",
    expectedTool: { 2: "search", 3: "search" },
  },
  {
    id: "fetch-default-document",
    prompt: "Fetch the complete body of Card card-1 after search found its ID.",
    expectedTool: { 2: "get_block", 3: "fetch" },
  },
  {
    id: "fetch-summary",
    prompt: "Fetch only a compact summary of Card card-1.",
    expectedTool: { 2: "get_block", 3: "fetch" },
  },
  {
    id: "create-tab-nested-toggle",
    prompt: "Create a Card containing a toggle with a child paragraph and child task, using the namespace format hint.",
    expectedTool: { 2: "create", 3: "create_cards" },
  },
  {
    id: "create-leading-spaces",
    prompt: "Create a Card whose paragraph intentionally begins with two spaces; preserve those spaces as authored content.",
    expectedTool: { 2: "create", 3: "create_cards" },
  },
  {
    id: "create-multiple-rich-titles",
    prompt: "Atomically create three Cards, including one title with bold inline text, in the same destination.",
    expectedTool: { 2: "create", 3: "create_cards" },
  },
  {
    id: "update-title-only",
    prompt: "Update only the title of Card card-1.",
    expectedTool: { 2: "edit_document", 3: "update_card" },
  },
  {
    id: "update-multiple-patches",
    prompt: "Apply two exact textual patches to Card card-1 without replacing unrelated content.",
    expectedTool: { 2: "edit_document", 3: "update_card" },
  },
  {
    id: "query-saved-view",
    prompt: "Read the current rows of saved Database View view-1.",
    expectedTool: { 2: "query_database", 3: "query_database_view" },
  },
  {
    id: "query-ad-hoc",
    prompt: "Query Database database-1 with a temporary Status=Todo filter and due-date sort.",
    expectedTool: { 2: "query_database", 3: "advanced_query_database" },
  },
  {
    id: "move-multiple-cards",
    prompt: "Move Cards card-1 and card-2 to the end of the same destination.",
    expectedTool: { 2: "transfer_blocks", 3: "move_cards" },
  },
  {
    id: "duplicate-one-card",
    prompt: "Duplicate Card card-1, including its complete owned body, into the destination.",
    expectedTool: { 2: "transfer_blocks", 3: "duplicate_card" },
  },
  {
    id: "update-stable-block",
    prompt: "After reading stable Blocks, update one known child Block while preserving its identity.",
    expectedTool: { 2: "edit_document", 3: "advanced_update_card" },
  },
] as const;

const BenchmarkSampleSchema = z.strictObject({
  caseId: z.string().min(1),
  selectedTool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
  semanticSuccess: z.boolean(),
  correctionCalls: z.number().int().min(0),
});

export const NodexAgentComprehensionRunSchema = z.strictObject({
  revision: z.number().int().positive(),
  samples: z.array(BenchmarkSampleSchema).min(1),
}).superRefine((run, context) => {
  const knownCases = new Set(NODEX_AGENT_COMPREHENSION_CASES.map((entry) => entry.id));
  const seen = new Set<string>();
  for (const [index, sample] of run.samples.entries()) {
    if (!knownCases.has(sample.caseId)) {
      context.addIssue({
        code: "custom",
        message: `Unknown comprehension case: ${sample.caseId}`,
        path: ["samples", index, "caseId"],
      });
    }
    if (seen.has(sample.caseId)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate comprehension case: ${sample.caseId}`,
        path: ["samples", index, "caseId"],
      });
    }
    seen.add(sample.caseId);
  }
});

export type NodexAgentComprehensionRun = z.infer<
  typeof NodexAgentComprehensionRunSchema
>;

export interface NodexAgentComprehensionSummary {
  readonly revision: number;
  readonly sampleCount: number;
  readonly correctToolSelections: number;
  readonly validFirstCalls: number;
  readonly validResults: number;
  readonly semanticSuccesses: number;
  readonly totalCorrectionCalls: number;
  readonly totalArgumentBytes: number;
  readonly cases: readonly {
    readonly caseId: string;
    readonly selectedTool: string;
    readonly toolSelectionCorrect: boolean;
    readonly firstCallValid: boolean;
    readonly resultValid: boolean;
    readonly semanticSuccess: boolean;
    readonly correctionCalls: number;
    readonly argumentBytes: number;
  }[];
}

type BenchmarkContracts = Readonly<Record<
  string,
  { readonly inputSchema: z.ZodType; readonly outputSchema: z.ZodType }
>>;

export function summarizeNodexAgentComprehensionRun(
  rawRun: unknown,
): NodexAgentComprehensionSummary {
  const run = NodexAgentComprehensionRunSchema.parse(rawRun);
  const contractsByRevision: Readonly<Record<number, BenchmarkContracts>> = {
    [NODEX_APP_V2_TOOLSET_REVISION]: NODEX_AGENT_TOOL_CONTRACTS,
    [NODEX_APP_V3_TOOLSET_REVISION]: NODEX_AGENT_V3_TOOL_CONTRACTS,
  };
  const contractEntries = contractsByRevision[run.revision];
  if (!contractEntries) {
    throw new Error(
      `This checkout cannot validate nodex_app@${run.revision}`,
    );
  }
  const casesById = new Map(
    NODEX_AGENT_COMPREHENSION_CASES.map((entry) => [entry.id, entry]),
  );
  const cases = run.samples.map((sample) => {
    const benchmarkCase = casesById.get(sample.caseId);
    if (!benchmarkCase) throw new Error(`Unknown benchmark case: ${sample.caseId}`);
    const contract = contractEntries[sample.selectedTool];
    const firstCallValid = contract?.inputSchema.safeParse(sample.arguments).success === true;
    const resultValid = sample.result === undefined
      ? true
      : contract?.outputSchema.safeParse(sample.result).success === true;

    return {
      caseId: sample.caseId,
      selectedTool: sample.selectedTool,
      toolSelectionCorrect: benchmarkCase.expectedTool[run.revision] === sample.selectedTool,
      firstCallValid,
      resultValid,
      semanticSuccess: sample.semanticSuccess,
      correctionCalls: sample.correctionCalls,
      argumentBytes: Buffer.byteLength(JSON.stringify(sample.arguments), "utf8"),
    };
  });

  return {
    revision: run.revision,
    sampleCount: cases.length,
    correctToolSelections: cases.filter((entry) => entry.toolSelectionCorrect).length,
    validFirstCalls: cases.filter((entry) => entry.firstCallValid).length,
    validResults: cases.filter((entry) => entry.resultValid).length,
    semanticSuccesses: cases.filter((entry) => entry.semanticSuccess).length,
    totalCorrectionCalls: cases.reduce((sum, entry) => sum + entry.correctionCalls, 0),
    totalArgumentBytes: cases.reduce((sum, entry) => sum + entry.argumentBytes, 0),
    cases,
  };
}

export function createNodexAgentComprehensionTemplate(
  revision: 2 | 3 = NODEX_APP_TOOLSET_REVISION,
): unknown {
  const fallbackTool = revision === NODEX_APP_V3_TOOLSET_REVISION
    ? NODEX_APP_V3_TOOLS[0]
    : NODEX_APP_V2_TOOLS[0];
  return {
    revision,
    samples: NODEX_AGENT_COMPREHENSION_CASES.map((entry) => ({
      caseId: entry.id,
      selectedTool: entry.expectedTool[revision] ?? fallbackTool,
      arguments: {},
      semanticSuccess: false,
      correctionCalls: 0,
    })),
  };
}
