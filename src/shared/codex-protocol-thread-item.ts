import threadItemJsonSchema from "@nodex/codex-app-server-protocol/runtime-schemas/ThreadItem.schema.json";
import type { ThreadItem } from "@nodex/codex-app-server-protocol/v2/ThreadItem";
import { createGeneratedCodexSchema } from "./generated-codex-schema";

export const CodexProtocolThreadItemSchema =
  createGeneratedCodexSchema<ThreadItem>(threadItemJsonSchema);

/** Runtime boundary for the generated `ThreadItem` union. */
export function isCodexProtocolThreadItem(value: unknown): value is ThreadItem {
  return CodexProtocolThreadItemSchema.safeParse(value).success;
}

export function parseCodexProtocolThreadItem(value: unknown): ThreadItem | null {
  const result = CodexProtocolThreadItemSchema.safeParse(value);
  return result.success ? result.data : null;
}
