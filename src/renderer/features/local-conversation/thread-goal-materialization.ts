import type {
  CodexThreadGoalDraftInput,
  CodexThreadGoalMaterializedDraft,
} from "@/lib/types";
import { invoke } from "@/lib/api";

const THREAD_GOAL_LONG_OBJECTIVE_THRESHOLD = 4000;

function hasThreadGoalMaterializedAttachments(draft: CodexThreadGoalDraftInput): boolean {
  return (draft.pastedTextAttachments?.length ?? 0) > 0
    || (draft.imageAttachments?.length ?? 0) > 0;
}

function normalizeMaterializedDraftResponse(response: unknown): CodexThreadGoalMaterializedDraft {
  if (!response || typeof response !== "object") {
    throw new Error("Thread goal materialization returned an invalid response");
  }

  const materialized = response as Partial<CodexThreadGoalMaterializedDraft>;
  if (typeof materialized.objective !== "string") {
    throw new Error("Thread goal materialization returned an invalid objective");
  }

  return {
    objective: materialized.objective,
    attachmentDirectory: typeof materialized.attachmentDirectory === "string"
      ? materialized.attachmentDirectory
      : null,
  };
}

export async function materializeThreadGoalDraft(
  draft: CodexThreadGoalDraftInput,
): Promise<CodexThreadGoalMaterializedDraft> {
  const trimmedObjective = draft.objective.trim();
  if (
    !hasThreadGoalMaterializedAttachments(draft)
    && Array.from(trimmedObjective).length <= THREAD_GOAL_LONG_OBJECTIVE_THRESHOLD
  ) {
    return {
      objective: trimmedObjective,
      attachmentDirectory: null,
    };
  }

  return normalizeMaterializedDraftResponse(
    await invoke("codex:thread:goal:materialize-draft", draft),
  );
}

export async function cleanupMaterializedThreadGoalDraft(
  materialized: CodexThreadGoalMaterializedDraft | null,
): Promise<void> {
  if (!materialized?.attachmentDirectory) return;
  await invoke("codex:thread:goal:materialized-cleanup", materialized.attachmentDirectory);
}

export async function readThreadGoalEditableObjective(objective: string): Promise<string> {
  const editableObjective = await invoke("codex:thread:goal:editable-objective:read", objective);
  if (typeof editableObjective !== "string") {
    throw new Error("Thread goal editable objective returned an invalid response");
  }
  return editableObjective;
}
