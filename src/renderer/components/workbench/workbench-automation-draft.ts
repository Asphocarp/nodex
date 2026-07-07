import type {
  CodexScheduledAutomation,
  CodexScheduledAutomationKind,
  CodexScheduledAutomationStatus,
  CodexScheduledAutomationUpsertInput,
} from "@/lib/types";

export const DEFAULT_WORKBENCH_AUTOMATION_RRULE = "FREQ=DAILY";

export interface WorkbenchAutomationDraft {
  id: string | null;
  kind: CodexScheduledAutomationKind;
  status: CodexScheduledAutomationStatus;
  targetThreadId: string;
  name: string;
  rrule: string;
  nextRunAtLocal: string;
}

export interface WorkbenchAutomationDraftValidation {
  canSave: boolean;
  error: string | null;
}

function normalizeOptionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeKind(kind: CodexScheduledAutomationKind): CodexScheduledAutomationKind {
  return kind === "cron" ? "cron" : "heartbeat";
}

function normalizeStatus(status: CodexScheduledAutomationStatus): CodexScheduledAutomationStatus {
  return status === "PAUSED" || status === "DELETED" ? status : "ACTIVE";
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function createCodexScheduledAutomationId(
  randomUUID: (() => string) | undefined = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
): string {
  const suffix = randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `automation-${suffix}`;
}

export function formatTimestampForDateTimeLocal(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) return "";

  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";

  return [
    date.getFullYear(),
    "-",
    padDatePart(date.getMonth() + 1),
    "-",
    padDatePart(date.getDate()),
    "T",
    padDatePart(date.getHours()),
    ":",
    padDatePart(date.getMinutes()),
  ].join("");
}

export function parseDateTimeLocalTimestamp(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;

  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function createWorkbenchAutomationDraft(input: {
  automation?: CodexScheduledAutomation | null;
  id?: string;
} = {}): WorkbenchAutomationDraft {
  const { automation } = input;
  return {
    id: automation?.id ?? input.id ?? createCodexScheduledAutomationId(),
    kind: normalizeKind(automation?.kind ?? "heartbeat"),
    status: normalizeStatus(automation?.status ?? "ACTIVE"),
    targetThreadId: automation?.targetThreadId ?? "",
    name: automation?.name ?? "Scheduled task",
    rrule: automation?.rrule ?? DEFAULT_WORKBENCH_AUTOMATION_RRULE,
    nextRunAtLocal: formatTimestampForDateTimeLocal(automation?.nextRunAt),
  };
}

export function validateWorkbenchAutomationDraft(
  draft: WorkbenchAutomationDraft,
): WorkbenchAutomationDraftValidation {
  if (!normalizeOptionalText(draft.id ?? "")) {
    return {
      canSave: false,
      error: "Scheduled task id is missing.",
    };
  }

  if (!normalizeOptionalText(draft.name)) {
    return {
      canSave: false,
      error: "Scheduled task name is required.",
    };
  }

  const rrule = normalizeOptionalText(draft.rrule);
  if (rrule && !rrule.toUpperCase().replace(/^RRULE:/, "").split(";").some((part) => part.startsWith("FREQ="))) {
    return {
      canSave: false,
      error: "Schedule RRULE must include FREQ.",
    };
  }

  if (draft.nextRunAtLocal.trim().length > 0 && parseDateTimeLocalTimestamp(draft.nextRunAtLocal) === null) {
    return {
      canSave: false,
      error: "Next run must be a valid local date and time.",
    };
  }

  return {
    canSave: true,
    error: null,
  };
}

export function buildCodexScheduledAutomationUpsertInput(input: {
  draft: WorkbenchAutomationDraft;
  existing?: CodexScheduledAutomation | null;
  now?: number;
}): CodexScheduledAutomationUpsertInput | null {
  const validation = validateWorkbenchAutomationDraft(input.draft);
  if (!validation.canSave) return null;

  const now = input.now ?? Date.now();
  const id = normalizeOptionalText(input.draft.id ?? "");
  const name = normalizeOptionalText(input.draft.name);
  if (!id || !name) return null;

  return {
    id,
    kind: normalizeKind(input.draft.kind),
    status: normalizeStatus(input.draft.status),
    targetThreadId: normalizeOptionalText(input.draft.targetThreadId),
    name,
    rrule: normalizeOptionalText(input.draft.rrule),
    nextRunAt: parseDateTimeLocalTimestamp(input.draft.nextRunAtLocal),
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function isWorkbenchAutomationDraftDirty(input: {
  draft: WorkbenchAutomationDraft;
  existing: CodexScheduledAutomation | null;
}): boolean {
  const { draft, existing } = input;
  if (!existing) return true;

  return normalizeKind(draft.kind) !== existing.kind
    || normalizeStatus(draft.status) !== existing.status
    || normalizeOptionalText(draft.targetThreadId) !== existing.targetThreadId
    || normalizeOptionalText(draft.name) !== existing.name
    || normalizeOptionalText(draft.rrule) !== existing.rrule
    || parseDateTimeLocalTimestamp(draft.nextRunAtLocal) !== existing.nextRunAt;
}
