import commandDecisionJsonSchema from "@nodex/codex-app-server-protocol/runtime-schemas/CommandExecutionApprovalDecision.schema.json";
import fileDecisionJsonSchema from "@nodex/codex-app-server-protocol/runtime-schemas/FileChangeApprovalDecision.schema.json";
import type {
  CommandExecutionApprovalDecision,
  FileChangeApprovalDecision,
} from "@nodex/codex-app-server-protocol/v2";
import { z } from "zod";
import { createGeneratedCodexSchema } from "./generated-codex-schema";

export type CodexCommandApprovalDecision = CommandExecutionApprovalDecision;
export type CodexFileApprovalDecision = FileChangeApprovalDecision;

export type CodexApprovalResponse =
  | { readonly kind: "command"; readonly decision: CodexCommandApprovalDecision }
  | { readonly kind: "file"; readonly decision: CodexFileApprovalDecision };

const CommandDecisionSchema =
  createGeneratedCodexSchema<CodexCommandApprovalDecision>(commandDecisionJsonSchema);
const FileDecisionSchema =
  createGeneratedCodexSchema<CodexFileApprovalDecision>(fileDecisionJsonSchema);

export const CodexApprovalResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("command"), decision: CommandDecisionSchema }),
  z.object({ kind: z.literal("file"), decision: FileDecisionSchema }),
]) satisfies z.ZodType<CodexApprovalResponse>;

export function parseCodexApprovalResponse(value: unknown): CodexApprovalResponse | null {
  const parsed = CodexApprovalResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
