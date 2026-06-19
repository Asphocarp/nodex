import type { CodexThreadSummary } from "@/lib/types";

export type ThreadMentionTone = "normal" | "muted" | "error";

export interface ThreadMentionDisplayInput {
  uuid: string;
  thread?: CodexThreadSummary | null;
  resolving?: boolean;
  missing?: boolean;
}

export interface ThreadMentionDisplay {
  label: string;
  detail: string;
  stateLabel: string;
  shortUuid: string;
  title: string;
  tone: ThreadMentionTone;
}

export function formatThreadMentionShortUuid(uuid: string): string {
  const trimmed = uuid.trim();
  if (trimmed.length <= 12) return trimmed || "unknown";
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

function firstPreviewLine(thread: CodexThreadSummary): string {
  return thread.threadPreview
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

function resolveThreadStateLabel(thread: CodexThreadSummary | null, resolving: boolean, missing: boolean): string {
  if (resolving) return "Loading";
  if (missing) return "Missing";
  if (!thread) return "Thread";
  if (thread.archived) return "Archived";
  if (thread.statusType === "systemError") return "Error";
  if (thread.statusActiveFlags.includes("waitingOnApproval")) return "Approval";
  if (thread.statusActiveFlags.includes("waitingOnUserInput")) return "Waiting";
  if (thread.statusType === "active") return "Running";
  if (thread.statusType === "idle") return "Ready";
  return "Thread";
}

export function resolveThreadMentionDisplay(input: ThreadMentionDisplayInput): ThreadMentionDisplay {
  const uuid = input.uuid.trim();
  const thread = input.thread ?? null;
  const resolving = input.resolving === true;
  const missing = input.missing === true;
  const label = missing
    ? "Missing thread"
    : thread?.threadName?.trim()
      || (thread ? firstPreviewLine(thread) : "")
      || formatThreadMentionShortUuid(uuid);
  const stateLabel = resolveThreadStateLabel(thread, resolving, missing);
  const shortUuid = formatThreadMentionShortUuid(uuid);
  const detail = [stateLabel, shortUuid]
    .filter((value) => value.trim().length > 0)
    .join(" · ");
  const title = [label, detail, thread?.cwd ?? ""]
    .filter((value) => value.trim().length > 0)
    .join(" - ");
  const tone = missing || thread?.statusType === "systemError"
    ? "error"
    : thread?.archived || resolving
      ? "muted"
      : "normal";

  return { label, detail, stateLabel, shortUuid, title, tone };
}
