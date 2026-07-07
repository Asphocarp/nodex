import { AlertCircle, ArrowLeft, CalendarClock, ListChecks, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NodexButton, NodexSwitch } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CODEX_SETTINGS_SHELL_STYLE } from "@/components/ui/settings";
import { invoke } from "@/lib/api";
import {
  formatCodexScheduledAutomationNextRunLabel,
  formatCodexScheduledAutomationRruleSummary,
  sortCodexScheduledAutomationsForDisplay,
} from "@/lib/codex-scheduled-automation-display";
import { queryKeys } from "@/lib/query-keys";
import { useCodexScheduledAutomations } from "@/lib/use-codex-scheduled-automations";
import type { CodexScheduledAutomation } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  buildCodexScheduledAutomationUpsertInput,
  createWorkbenchAutomationDraft,
  DEFAULT_WORKBENCH_AUTOMATION_RRULE,
  isWorkbenchAutomationDraftDirty,
  validateWorkbenchAutomationDraft,
  type WorkbenchAutomationDraft,
} from "./workbench-automation-draft";
import {
  buildAutomationsPath,
  resolveAutomationsRouteState,
  updateAutomationsPath,
} from "./workbench-automations-routes";

interface WorkbenchAutomationsRouteShellProps {
  path: string;
  onPathChange: (path: string) => void;
  onBackToApp: () => void;
}

function formatAutomationStatus(status: CodexScheduledAutomation["status"]): string {
  if (status === "ACTIVE") return "Active";
  if (status === "PAUSED") return "Paused";
  return "Deleted";
}

function formatAutomationKind(kind: CodexScheduledAutomation["kind"]): string {
  return kind === "heartbeat" ? "Scheduled task chat" : "Scheduled task";
}

function formatAutomationTimestamp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "None";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function upsertAutomationInList(
  automations: CodexScheduledAutomation[] | undefined,
  automation: CodexScheduledAutomation,
): CodexScheduledAutomation[] {
  if (!automations) return [automation];
  const didReplace = automations.some((item) => item.id === automation.id);
  if (didReplace) {
    return automations.map((item) => (item.id === automation.id ? automation : item));
  }
  return [...automations, automation];
}

function deleteAutomationFromList(
  automations: CodexScheduledAutomation[] | undefined,
  automationId: string,
): CodexScheduledAutomation[] {
  return (automations ?? []).filter((automation) => automation.id !== automationId);
}

function resolveSchedulePreset(rrule: string): "daily" | "weekly" | "weekdays" | "custom" {
  const normalized = rrule.trim().replace(/^RRULE:/i, "").toUpperCase();
  if (normalized === "FREQ=DAILY") return "daily";
  if (normalized === "FREQ=WEEKLY") return "weekly";
  if (normalized === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") return "weekdays";
  return "custom";
}

function rruleForSchedulePreset(preset: "daily" | "weekly" | "weekdays" | "custom", current: string): string {
  if (preset === "daily") return DEFAULT_WORKBENCH_AUTOMATION_RRULE;
  if (preset === "weekly") return "FREQ=WEEKLY";
  if (preset === "weekdays") return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  return current.trim() || DEFAULT_WORKBENCH_AUTOMATION_RRULE;
}

function AutomationMetric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-token-border bg-token-bg-secondary px-3 py-2">
      <div className="text-xs text-token-text-tertiary">{label}</div>
      <div className="min-w-0 truncate text-sm text-token-foreground">{value}</div>
    </div>
  );
}

function AutomationDetailRows({ automation }: { automation: CodexScheduledAutomation }) {
  const scheduleSummary = formatCodexScheduledAutomationRruleSummary(automation.rrule) ?? "Custom schedule";
  const nextRunLabel = formatCodexScheduledAutomationNextRunLabel(automation.nextRunAt);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <AutomationMetric label="Status" value={formatAutomationStatus(automation.status)} />
      <AutomationMetric label="Kind" value={formatAutomationKind(automation.kind)} />
      <AutomationMetric label="Schedule" value={scheduleSummary} />
      <AutomationMetric label="Next run" value={nextRunLabel} />
      <AutomationMetric label="Target thread" value={automation.targetThreadId ?? "None"} />
      <AutomationMetric label="Updated" value={formatAutomationTimestamp(automation.updatedAt)} />
    </div>
  );
}

function AutomationListRow({
  automation,
  active,
  onSelect,
}: {
  automation: CodexScheduledAutomation;
  active: boolean;
  onSelect: () => void;
}) {
  const scheduleSummary = formatCodexScheduledAutomationRruleSummary(automation.rrule);
  return (
    <button
      type="button"
      data-testid={`automation-list-row-${automation.id}`}
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "group flex min-h-12 w-full cursor-interaction items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none",
        "hover:bg-token-list-hover-background focus-visible:ring-token-focus focus-visible:ring-2",
        active && "bg-token-list-active-selection-background text-token-list-active-selection-foreground",
      )}
    >
      <CalendarClock className={cn("icon-sm shrink-0 text-token-text-tertiary", active && "text-token-foreground")} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm text-token-foreground">{automation.name}</span>
        <span className="truncate text-xs text-token-text-secondary">
          {scheduleSummary ?? formatAutomationStatus(automation.status)}
        </span>
      </span>
    </button>
  );
}

function AutomationsEmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center px-6 py-8 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-token-bg-secondary text-token-text-secondary">
          {icon}
        </div>
        <div className="text-lg text-token-foreground">{title}</div>
        <div className="text-sm leading-5 text-token-text-secondary">{description}</div>
      </div>
    </div>
  );
}

function AutomationDetailSurface({
  automation,
  selectedAutomationId,
  mode,
  loading,
  onBackToList,
  onSave,
  onDelete,
  isMutating,
  errorMessage,
}: {
  automation: CodexScheduledAutomation | null;
  selectedAutomationId: string | null;
  mode: "create" | "edit" | "loading" | "missing" | null;
  loading: boolean;
  onBackToList: () => void;
  onSave: (draft: WorkbenchAutomationDraft) => Promise<void>;
  onDelete: (automation: CodexScheduledAutomation) => Promise<void>;
  isMutating: boolean;
  errorMessage: string | null;
}) {
  if (mode === "loading" || loading) {
    return (
      <AutomationsEmptyState
        icon={<CalendarClock className="icon-sm" />}
        title="Loading scheduled task"
        description="Reading the latest automation metadata for this workspace."
      />
    );
  }

  if (mode === "missing") {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center px-6 py-8 text-center">
        <div className="flex max-w-md flex-col items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-token-bg-secondary text-token-text-secondary">
            <AlertCircle className="icon-sm" />
          </div>
          <div className="text-lg text-token-foreground">Scheduled task not found</div>
          <div className="text-sm leading-5 text-token-text-secondary">
            This scheduled task may have been deleted or is no longer available on this machine.
          </div>
          <NodexButton variant="secondary" size="sm" onClick={onBackToList}>
            Back to Scheduled
          </NodexButton>
        </div>
      </div>
    );
  }

  if (mode !== "create" && !automation) {
    return (
      <AutomationsEmptyState
        icon={<ListChecks className="icon-sm" />}
        title={selectedAutomationId ? "Scheduled task not found" : "Select a scheduled task"}
        description={selectedAutomationId ? "No local automation matches the selected id." : "Choose a scheduled task to inspect its target and next run."}
      />
    );
  }

  return (
    <AutomationDraftEditor
      automation={mode === "create" ? null : automation}
      mode={mode === "create" ? "create" : "edit"}
      onSave={onSave}
      onDelete={onDelete}
      isMutating={isMutating}
      errorMessage={errorMessage}
    />
  );
}

function AutomationDraftEditor({
  automation,
  mode,
  onSave,
  onDelete,
  isMutating,
  errorMessage,
}: {
  automation: CodexScheduledAutomation | null;
  mode: "create" | "edit";
  onSave: (draft: WorkbenchAutomationDraft) => Promise<void>;
  onDelete: (automation: CodexScheduledAutomation) => Promise<void>;
  isMutating: boolean;
  errorMessage: string | null;
}) {
  const [draft, setDraft] = useState<WorkbenchAutomationDraft>(() =>
    createWorkbenchAutomationDraft({ automation })
  );
  const [deleteConfirmationVisible, setDeleteConfirmationVisible] = useState(false);
  const validation = validateWorkbenchAutomationDraft(draft);
  const dirty = isWorkbenchAutomationDraftDirty({ draft, existing: automation });
  const canSave = validation.canSave && dirty && !isMutating;
  const schedulePreset = useMemo(() => resolveSchedulePreset(draft.rrule), [draft.rrule]);
  const draftUpsertInput = buildCodexScheduledAutomationUpsertInput({ draft, existing: automation });
  const nextRunLabel = formatCodexScheduledAutomationNextRunLabel(draftUpsertInput?.nextRunAt ?? null);

  useEffect(() => {
    setDraft(createWorkbenchAutomationDraft({ automation }));
    setDeleteConfirmationVisible(false);
  }, [automation?.id, mode]);

  const updateDraft = (patch: Partial<WorkbenchAutomationDraft>) => {
    setDraft((current) => ({
      ...current,
      ...patch,
    }));
  };

  const saveDraft = async () => {
    if (!canSave) return;
    await onSave(draft);
  };

  const deleteAutomation = async () => {
    if (!automation || isMutating) return;
    await onDelete(automation);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-panel">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-panel">
        <header className="flex min-w-0 items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="truncate text-heading-md text-token-foreground">
              {mode === "create" ? "Create scheduled task" : draft.name || "Untitled scheduled task"}
            </div>
            <div className="truncate text-base text-token-text-secondary">{nextRunLabel}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {automation ? (
              deleteConfirmationVisible ? (
                <>
                  <NodexButton
                    variant="ghost"
                    size="sm"
                    disabled={isMutating}
                    onClick={() => setDeleteConfirmationVisible(false)}
                  >
                    Cancel
                  </NodexButton>
                  <NodexButton
                    variant="destructive"
                    size="sm"
                    disabled={isMutating}
                    onClick={() => void deleteAutomation()}
                  >
                    <Trash2 className="icon-xs" />
                    Delete
                  </NodexButton>
                </>
              ) : (
                <NodexButton
                  variant="ghost"
                  size="sm"
                  disabled={isMutating}
                  onClick={() => setDeleteConfirmationVisible(true)}
                >
                  <Trash2 className="icon-xs" />
                  Delete
                </NodexButton>
              )
            ) : null}
            <NodexButton
              variant="primary"
              size="sm"
              disabled={!canSave}
              onClick={() => void saveDraft()}
            >
              <Save className="icon-xs" />
              {mode === "create" ? "Create" : "Save"}
            </NodexButton>
          </div>
        </header>

        {errorMessage ? (
          <div className="rounded-lg border border-token-error-border bg-token-error-background px-3 py-2 text-sm text-token-error-foreground">
            {errorMessage}
          </div>
        ) : null}

        {validation.error ? (
          <div className="rounded-lg border border-token-border bg-token-bg-secondary px-3 py-2 text-sm text-token-text-secondary">
            {validation.error}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-token-text-primary">Name</span>
            <Input
              aria-label="Scheduled task name"
              value={draft.name}
              disabled={isMutating}
              onInput={(event) => updateDraft({ name: event.currentTarget.value })}
            />
          </label>

          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-token-text-primary">Kind</span>
            <select
              aria-label="Scheduled task kind"
              value={draft.kind}
              disabled={isMutating}
              onChange={(event) => updateDraft({ kind: event.currentTarget.value === "cron" ? "cron" : "heartbeat" })}
              className="h-9 w-full min-w-0 rounded-md border border-token-input-border bg-token-input-background px-2.5 text-base text-token-input-foreground outline-none focus:border-token-focus-border disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="heartbeat">Scheduled task chat</option>
              <option value="cron">Scheduled task</option>
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-token-text-primary">Target thread</span>
            <Input
              aria-label="Target thread"
              value={draft.targetThreadId}
              disabled={isMutating}
              placeholder="thread id"
              onInput={(event) => updateDraft({ targetThreadId: event.currentTarget.value })}
            />
          </label>

          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-token-text-primary">Status</span>
            <div className="flex h-9 items-center justify-between rounded-md border border-token-input-border bg-token-input-background px-2.5">
              <span className="text-base text-token-input-foreground">
                {draft.status === "ACTIVE" ? "Active" : "Paused"}
              </span>
              <NodexSwitch
                checked={draft.status === "ACTIVE"}
                disabled={isMutating}
                onCheckedChange={(checked) => updateDraft({ status: checked ? "ACTIVE" : "PAUSED" })}
              />
            </div>
          </div>

          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-token-text-primary">Schedule</span>
            <select
              aria-label="Schedule"
              value={schedulePreset}
              disabled={isMutating}
              onChange={(event) => {
                const value = event.currentTarget.value as "daily" | "weekly" | "weekdays" | "custom";
                updateDraft({ rrule: rruleForSchedulePreset(value, draft.rrule) });
              }}
              className="h-9 w-full min-w-0 rounded-md border border-token-input-border bg-token-input-background px-2.5 text-base text-token-input-foreground outline-none focus:border-token-focus-border disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="weekdays">Every weekday</option>
              <option value="custom">Custom RRULE</option>
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-token-text-primary">Next run</span>
            <Input
              aria-label="Next run"
              type="datetime-local"
              value={draft.nextRunAtLocal}
              disabled={isMutating || draft.status !== "ACTIVE"}
              onInput={(event) => updateDraft({ nextRunAtLocal: event.currentTarget.value })}
            />
          </label>
        </section>

        <section className="flex flex-col gap-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-token-text-primary">Schedule source</span>
            <Input
              aria-label="Schedule RRULE"
              value={draft.rrule}
              disabled={isMutating}
              onInput={(event) => updateDraft({ rrule: event.currentTarget.value })}
              className="font-mono text-sm"
            />
          </label>
        </section>

        {automation ? (
          <section className="flex flex-col gap-2">
            <div className="text-base font-medium text-token-text-primary">Overview</div>
            <AutomationDetailRows automation={automation} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function WorkbenchAutomationsRouteShell({
  path,
  onPathChange,
  onBackToApp,
}: WorkbenchAutomationsRouteShellProps) {
  const queryClient = useQueryClient();
  const routeState = resolveAutomationsRouteState(path);
  const automationsQuery = useCodexScheduledAutomations();
  const [mutatingAutomationId, setMutatingAutomationId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const automations = sortCodexScheduledAutomationsForDisplay(automationsQuery.data ?? []);
  const selectedAutomation = routeState.automationId === null
    ? null
    : automations.find((automation) => automation.id === routeState.automationId) ?? null;
  const detailMode = routeState.automationMode === "create"
    ? "create"
    : routeState.automationId === null
      ? null
      : selectedAutomation === null
        ? automationsQuery.isLoading || automationsQuery.isFetching
          ? "loading"
          : "missing"
        : "edit";

  const openAutomation = (automation: CodexScheduledAutomation) => {
    setMutationError(null);
    onPathChange(buildAutomationsPath({
      tab: "tasks",
      automationId: automation.id,
    }));
  };

  const openTasksTab = () => {
    setMutationError(null);
    onPathChange(buildAutomationsPath({ tab: "tasks" }));
  };

  const openTemplatesTab = () => {
    setMutationError(null);
    onPathChange(buildAutomationsPath({ tab: "templates" }));
  };

  const openCreateMode = () => {
    setMutationError(null);
    onPathChange(updateAutomationsPath(path, {
      tab: "tasks",
      automationId: null,
      automationMode: "create",
    }));
  };

  const backToList = () => {
    setMutationError(null);
    onPathChange(buildAutomationsPath({ tab: routeState.tab }));
  };

  const saveAutomation = async (draft: WorkbenchAutomationDraft) => {
    const input = buildCodexScheduledAutomationUpsertInput({
      draft,
      existing: selectedAutomation,
    });
    if (!input) return;

    setMutationError(null);
    setMutatingAutomationId(input.id);
    try {
      const saved = await invoke("codex:scheduled-automations:upsert", input) as CodexScheduledAutomation;
      queryClient.setQueryData<CodexScheduledAutomation[]>(
        queryKeys.codexScheduledAutomations.list(),
        (current) => upsertAutomationInList(current, saved),
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.codexScheduledAutomations.list(),
      });
      setMutationError(null);
      onPathChange(buildAutomationsPath({
        tab: "tasks",
        automationId: saved.id,
      }));
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not save scheduled task.");
    } finally {
      setMutatingAutomationId(null);
    }
  };

  const deleteAutomation = async (automation: CodexScheduledAutomation) => {
    setMutationError(null);
    setMutatingAutomationId(automation.id);
    try {
      const deleted = await invoke("codex:scheduled-automations:delete", automation.id) as boolean;
      if (!deleted) {
        setMutationError("Could not delete scheduled task.");
        return;
      }
      queryClient.setQueryData<CodexScheduledAutomation[]>(
        queryKeys.codexScheduledAutomations.list(),
        (current) => deleteAutomationFromList(current, automation.id),
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.codexScheduledAutomations.list(),
      });
      setMutationError(null);
      if (routeState.automationId === automation.id) {
        onPathChange(buildAutomationsPath({ tab: routeState.tab }));
      }
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not delete scheduled task.");
    } finally {
      setMutatingAutomationId(null);
    }
  };

  return (
    <div
      data-testid="automations-route-shell"
      className="main-surface flex h-full min-h-0 w-full overflow-hidden text-token-text-primary"
      style={CODEX_SETTINGS_SHELL_STYLE}
    >
      <aside className="app-shell-left-panel hidden min-h-0 w-token-sidebar shrink-0 flex-col overflow-hidden border-r border-token-border md:flex">
        <div className="draggable flex h-toolbar shrink-0 items-center px-2">
          <NodexButton variant="ghost" size="sm" onClick={onBackToApp}>
            <ArrowLeft className="icon-xs" />
            Back to app
          </NodexButton>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-4 px-2 pb-4" aria-label="Scheduled task folders">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              aria-pressed={routeState.tab === "tasks"}
              onClick={openTasksTab}
              className={cn(
                "flex h-token-nav-row cursor-interaction items-center gap-2 rounded-lg px-row-x py-row-y text-left text-sm outline-none",
                "hover:bg-token-list-hover-background focus-visible:ring-token-focus focus-visible:ring-2",
                routeState.tab === "tasks" && "bg-token-list-active-selection-background text-token-list-active-selection-foreground",
              )}
            >
              <ListChecks className="icon-sm shrink-0" />
              <span className="min-w-0 flex-1 truncate">Scheduled tasks</span>
            </button>
            <button
              type="button"
              aria-pressed={routeState.tab === "templates"}
              onClick={openTemplatesTab}
              className={cn(
                "flex h-token-nav-row cursor-interaction items-center gap-2 rounded-lg px-row-x py-row-y text-left text-sm outline-none",
                "hover:bg-token-list-hover-background focus-visible:ring-token-focus focus-visible:ring-2",
                routeState.tab === "templates" && "bg-token-list-active-selection-background text-token-list-active-selection-foreground",
              )}
            >
              <CalendarClock className="icon-sm shrink-0" />
              <span className="min-w-0 flex-1 truncate">Templates</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {routeState.tab === "templates" ? (
              <div className="px-2 py-3 text-sm text-token-text-secondary">
                Scheduled task templates are not stored locally yet.
              </div>
            ) : automations.length === 0 ? (
              <div className="px-2 py-3 text-sm text-token-text-secondary">
                No scheduled tasks.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {automations.map((automation) => (
                  <AutomationListRow
                    key={automation.id}
                    automation={automation}
                    active={automation.id === routeState.automationId}
                    onSelect={() => openAutomation(automation)}
                  />
                ))}
              </div>
            )}
          </div>

          <NodexButton variant="secondary" size="sm" onClick={openCreateMode}>
            <Plus className="icon-xs" />
            New scheduled task
          </NodexButton>
        </nav>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="draggable flex h-toolbar shrink-0 items-center justify-between gap-2 border-b border-token-border px-panel md:hidden">
          <NodexButton variant="ghost" size="sm" onClick={onBackToApp}>
            <ArrowLeft className="icon-xs" />
            Back to app
          </NodexButton>
          <NodexButton variant="secondary" size="sm" onClick={openCreateMode}>
            <Plus className="icon-xs" />
            New
          </NodexButton>
        </div>
        <AutomationDetailSurface
          automation={selectedAutomation}
          selectedAutomationId={routeState.automationId}
          mode={detailMode}
          loading={automationsQuery.isLoading}
          onBackToList={backToList}
          onSave={saveAutomation}
          onDelete={deleteAutomation}
          isMutating={mutatingAutomationId !== null}
          errorMessage={mutationError}
        />
      </main>
    </div>
  );
}
