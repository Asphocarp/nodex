import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, FileText, XIcon } from "lucide-react";
import {
  NODEX_DIFF_HOST_CLASS,
  getNodexDiffHostStyle,
  getNodexDiffOptions,
} from "../../lib/diff-presentation";
import { cn } from "@/lib/utils";
import type {
  HistoryCardVersionPreview,
  HistoryPanelDescriptionDelta,
  HistoryPanelDescriptionDeltaBlock,
  HistoryPanelDescriptionSnapshot,
  HistoryPanelDescriptionSnapshotBlock,
  HistoryPanelEntry,
} from "../../../shared/ipc-api";
import type { Card } from "../../../shared/types";
import { ReadonlyNfmBlockNotePreview } from "./editor/readonly-nfm-blocknote-preview";
import { NodexButton } from "@/components/ui/button";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import {
  invoke,
  KANBAN_STATUS_LABELS,
  MultiFileDiff,
  useTheme,
} from "./history-panel-deps";

type HistoryOperationFilter = "all" | HistoryPanelEntry["operation"];

const OPERATION_FILTERS: Array<{ value: HistoryOperationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "update", label: "Updates" },
  { value: "move", label: "Moves" },
  { value: "create", label: "Creates" },
  { value: "delete", label: "Deletes" },
];

const COLUMN_LABELS: Record<string, string> = KANBAN_STATUS_LABELS;

const FIELD_LABELS: Record<string, string> = {
  id: "Card ID",
  title: "Title",
  description: "Description",
  priority: "Priority",
  estimate: "Estimate",
  tags: "Tags",
  dueDate: "Due date",
  scheduledStart: "Scheduled start",
  scheduledEnd: "Scheduled end",
  isAllDay: "All-day",
  assignee: "Assignee",
  agentBlocked: "Blocked",
  agentStatus: "Agent status",
  created: "Created",
  order: "Order",
};

interface HistoryPanelProps {
  projectId: string;
  cardId: string | null;
  cardTitle?: string;
  projectWorkspacePath?: string | null;
  open: boolean;
  onClose: () => void;
  onCardMutated?: () => void;
}

export function HistoryPanel({
  projectId,
  cardId,
  cardTitle,
  projectWorkspacePath,
  open,
  onClose,
  onCardMutated,
}: HistoryPanelProps) {
  const [entries, setEntries] = useState<HistoryPanelEntry[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [operationFilter, setOperationFilter] = useState<HistoryOperationFilter>("all");
  const [loading, setLoading] = useState(false);
  const [previewCache, setPreviewCache] = useState<Record<number, HistoryCardVersionPreview>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Action state
  const [actionInFlight, setActionInFlight] = useState<"revert" | "restore" | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<{
    type: "revert" | "restore";
    entryId: number;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchHistory = useCallback(async (targetCardId: string) => {
    setLoading(true);
    try {
      const data = (await invoke(
        "history:card",
        projectId,
        targetCardId
      )) as { entries: HistoryPanelEntry[] };
      const nextEntries = (data.entries || []).map(normalizeHistoryPanelEntry);
      setEntries(nextEntries);
      setSelectedEntryId((current) => {
        if (!nextEntries.length) return null;
        if (current !== null && nextEntries.some((entry) => entry.id === current)) {
          return current;
        }
        return nextEntries[0].id;
      });
      setPreviewCache({});
    } catch (err) {
      console.error("Failed to fetch history:", err);
      setEntries([]);
      setSelectedEntryId(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open && cardId) {
      fetchHistory(cardId);
    }
  }, [open, cardId, fetchHistory]);

  useEffect(() => {
    if (open) return;
    setOperationFilter("all");
    setConfirmingAction(null);
    setActionError(null);
    setPreviewCache({});
    setPreviewError(null);
  }, [open]);

  // Clear confirmation when selected entry changes
  useEffect(() => {
    setConfirmingAction(null);
    setActionError(null);
  }, [selectedEntryId]);

  const filteredEntries = useMemo(() => {
    if (operationFilter === "all") return entries;
    return entries.filter((entry) => entry.operation === operationFilter);
  }, [entries, operationFilter]);

  useEffect(() => {
    if (filteredEntries.length === 0) {
      setSelectedEntryId(null);
      return;
    }
    if (selectedEntryId !== null && filteredEntries.some((entry) => entry.id === selectedEntryId)) {
      return;
    }
    setSelectedEntryId(filteredEntries[0].id);
  }, [filteredEntries, selectedEntryId]);

  const selectedIndex = useMemo(
    () => filteredEntries.findIndex((entry) => entry.id === selectedEntryId),
    [filteredEntries, selectedEntryId]
  );

  const selectedEntry = selectedIndex >= 0 ? filteredEntries[selectedIndex] : null;
  const selectedPreview = selectedEntry ? previewCache[selectedEntry.id] ?? null : null;

  const navigateSelectedEntry = useCallback((direction: -1 | 1) => {
    if (filteredEntries.length === 0) return;

    const currentIndex = filteredEntries.findIndex((entry) => entry.id === selectedEntryId);
    if (currentIndex === -1) {
      setSelectedEntryId(filteredEntries[0].id);
      return;
    }

    const nextIndex = Math.min(
      filteredEntries.length - 1,
      Math.max(0, currentIndex + direction)
    );
    setSelectedEntryId(filteredEntries[nextIndex].id);
  }, [filteredEntries, selectedEntryId]);

  const handleListKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      navigateSelectedEntry(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      navigateSelectedEntry(-1);
    }
  }, [navigateSelectedEntry]);

  useEffect(() => {
    if (!open || !cardId || !selectedEntry) {
      setPreviewLoading(false);
      return;
    }
    if (!selectedEntry.reconstructable) {
      setPreviewLoading(false);
      setPreviewError(selectedEntry.reconstructionUnavailableReason ?? "This version is unavailable.");
      return;
    }
    if (previewCache[selectedEntry.id]) {
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    void (async () => {
      try {
        const data = await invoke(
          "history:card-version-preview",
          projectId,
          cardId,
          selectedEntry.id,
        ) as { preview: HistoryCardVersionPreview | null; error?: string };
        if (cancelled) return;
        if (!data.preview) {
          setPreviewError(data.error ?? "Version preview is unavailable.");
          return;
        }
        setPreviewCache((current) => ({ ...current, [selectedEntry.id]: data.preview as HistoryCardVersionPreview }));
      } catch (err) {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : "Version preview is unavailable.");
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cardId, open, previewCache, projectId, selectedEntry]);

  // Action handlers
  const handleRevert = useCallback(async (entryId: number, operation: string) => {
    setActionInFlight("revert");
    setActionError(null);
    try {
      const result = await invoke("history:revert", projectId, entryId) as { success: boolean; error?: string };
      if (!result.success) {
        setActionError(result.error ?? "Revert failed");
        return;
      }
      setConfirmingAction(null);
      onCardMutated?.();
      // If reverting a create (card deleted), close the panel
      if (operation === "create") {
        onClose();
        return;
      }
      if (cardId) await fetchHistory(cardId);
      setPreviewCache({});
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Revert failed");
    } finally {
      setActionInFlight(null);
    }
  }, [projectId, cardId, fetchHistory, onCardMutated, onClose]);

  const handleRestore = useCallback(async (entryId: number) => {
    if (!cardId) return;
    setActionInFlight("restore");
    setActionError(null);
    try {
      const result = await invoke("history:restore", projectId, cardId, entryId) as { success: boolean; error?: string };
      if (!result.success) {
        setActionError(result.error ?? "Restore failed");
        return;
      }
      setConfirmingAction(null);
      onCardMutated?.();
      await fetchHistory(cardId);
      setPreviewCache({});
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setActionInFlight(null);
    }
  }, [projectId, cardId, fetchHistory, onCardMutated]);

  const canRestoreSelected = Boolean(
    selectedEntry
      && selectedEntry.reconstructable
      && !selectedEntry.isUndone
      && selectedEntry.undoOf === null,
  );
  const restoringSelected = confirmingAction?.type === "restore" && confirmingAction.entryId === selectedEntry?.id;

  if (!open) {
    return null;
  }

  return (
    <NodexDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <NodexDialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        overlayClassName="bg-black/55"
        style={{
          width: "min(94vw, 1600px)",
          maxWidth: "calc(100vw - 1.5rem)",
          height: "min(92vh, calc(100vh - 1.5rem))",
        }}
        className={cn(
          "max-w-none gap-0 overflow-hidden rounded-xl p-0 sm:max-w-none",
          "grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]",
        )}
      >
        <NodexDialogTitle className="sr-only">Version history</NodexDialogTitle>
        <section className="flex min-h-0 min-w-0 flex-col bg-token-main-surface-primary">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[0.5px] border-token-border px-3">
            <FileText className="icon-2xs shrink-0 text-token-description-foreground" />
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-token-text-secondary">
              {selectedPreview?.card.title ?? cardTitle ?? "Untitled card"}
            </div>
            {selectedEntry ? (
              <div className="hidden shrink-0 text-xs text-token-description-foreground sm:block">
                {formatAbsoluteTimestamp(selectedEntry.timestamp)}
              </div>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 max-md:px-4 max-md:py-5">
            {loading ? (
              <div className="py-10 text-center text-sm text-token-description-foreground">
                Loading history...
              </div>
            ) : entries.length === 0 ? (
              <div className="py-10 text-center text-sm text-token-description-foreground">
                No history for this card
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
                <HistoryVersionPreview
                  preview={selectedPreview}
                  loading={previewLoading}
                  error={previewError}
                  fallbackTitle={cardTitle}
                  projectWorkspacePath={projectWorkspacePath}
                />

                {selectedEntry ? (
                  <HistoryEntryDetails
                    entry={selectedEntry}
                    selectedIndex={selectedIndex}
                    totalCount={filteredEntries.length}
                    onNavigate={navigateSelectedEntry}
                    onRevert={handleRevert}
                    onRestore={handleRestore}
                    actionInFlight={actionInFlight}
                    confirmingAction={confirmingAction}
                    onRequestConfirm={setConfirmingAction}
                    onCancelConfirm={() => { setConfirmingAction(null); setActionError(null); }}
                    actionError={actionError}
                    showRestoreAction={false}
                  />
                ) : (
                  <div className="py-8 text-center text-sm text-token-description-foreground">
                    Select an entry to view details.
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-l border-[0.5px] border-token-border bg-token-bg-fog/70 max-md:border-l-0 max-md:border-t">
          <header className="flex shrink-0 items-start gap-2 px-3 py-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg font-semibold leading-6 text-token-text-primary">
                Version history
              </h3>
              <div className="mt-0.5 text-xs text-token-description-foreground">
                {filteredEntries.length}/{entries.length}
              </div>
            </div>
            <NodexButton
              type="button"
              variant="ghost"
              size="icon-xs"
              className="rounded-full text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-text-primary"
              aria-label="Close history panel"
              onClick={onClose}
            >
              <XIcon className="icon-2xs" />
            </NodexButton>
          </header>

          <div className="shrink-0 px-2 pb-2">
            <div className="flex flex-wrap gap-1">
              {OPERATION_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setOperationFilter(filter.value)}
                  aria-pressed={operationFilter === filter.value}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs",
                    operationFilter === filter.value
                      ? "bg-token-foreground/10 text-token-text-primary"
                      : "text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-text-secondary",
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
            onKeyDown={handleListKeyDown}
          >
            {filteredEntries.length === 0 ? (
              <div className="px-2 py-3 text-xs text-token-description-foreground">
                No entries for this filter.
              </div>
            ) : (
              filteredEntries.map((entry) => (
                <HistoryEntryListItem
                  key={entry.id}
                  entry={entry}
                  selected={entry.id === selectedEntry?.id}
                  onSelect={() => setSelectedEntryId(entry.id)}
                />
              ))
            )}
          </div>

          <footer className="shrink-0 border-t border-[0.5px] border-token-border px-3 py-3">
            {restoringSelected && actionError ? (
              <p className="mb-2 text-xs text-(--priority-critical-text)">{actionError}</p>
            ) : null}
            {restoringSelected ? (
              <div className="mb-2 text-xs text-token-text-secondary">
                Restore card to {selectedEntry ? formatAbsoluteTimestamp(selectedEntry.timestamp) : "this version"}?
              </div>
            ) : null}
            {selectedEntry && !selectedEntry.reconstructable ? (
              <p className="mb-2 text-xs text-token-description-foreground">
                {selectedEntry.reconstructionUnavailableReason ?? "This version is unavailable."}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              {restoringSelected ? (
                <NodexButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={actionInFlight !== null}
                  onClick={() => { setConfirmingAction(null); setActionError(null); }}
                >
                  Cancel
                </NodexButton>
              ) : null}
              <NodexButton
                type="button"
                size="sm"
                disabled={!canRestoreSelected || actionInFlight !== null}
                onClick={() => {
                  if (!selectedEntry) return;
                  if (!restoringSelected) {
                    setConfirmingAction({ type: "restore", entryId: selectedEntry.id });
                    setActionError(null);
                    return;
                  }
                  void handleRestore(selectedEntry.id);
                }}
              >
                {actionInFlight === "restore" ? "Restoring..." : restoringSelected ? "Confirm restore" : "Restore"}
              </NodexButton>
            </div>
          </footer>
        </aside>
      </NodexDialogContent>
    </NodexDialog>
  );
}

function HistoryVersionPreview({
  preview,
  loading,
  error,
  fallbackTitle,
  projectWorkspacePath,
}: {
  preview: HistoryCardVersionPreview | null;
  loading: boolean;
  error: string | null;
  fallbackTitle?: string;
  projectWorkspacePath?: string | null;
}) {
  if (loading && !preview) {
    return (
      <div className="rounded-lg bg-token-foreground/5 px-3 py-8 text-center text-sm text-token-description-foreground">
        Loading version preview...
      </div>
    );
  }

  if (error && !preview) {
    return (
      <div className="rounded-lg bg-token-foreground/5 px-3 py-8 text-center text-sm text-token-description-foreground">
        {error}
      </div>
    );
  }

  const card = preview?.card ?? null;
  const properties = card ? collectCardPreviewProperties(card) : [];

  return (
    <article className="min-w-0">
      <h2 className="wrap-break-word text-xl/snug-plus font-bold tracking-normal text-token-text-primary">
        {card?.title ?? fallbackTitle ?? "Untitled card"}
      </h2>

      {card ? (
        <div className="mt-5 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
          {properties.map((property) => (
            <div key={property.label} className="contents">
              <div className="truncate text-token-description-foreground">{property.label}</div>
              <div className="min-w-0 wrap-break-word text-token-text-secondary">{property.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-8 min-h-32">
        {preview && card?.description?.trim() ? (
          <ReadonlyNfmBlockNotePreview
            content={card.description}
            projectId={preview.projectId}
            cardId={preview.cardId}
            historyId={preview.historyId}
            projectWorkspacePath={projectWorkspacePath}
            className="text-token-text-primary"
          />
        ) : (
          <div className="text-sm text-token-description-foreground">No description</div>
        )}
      </div>
    </article>
  );
}

function HistoryEntryListItem({
  entry,
  selected,
  onSelect,
}: {
  entry: HistoryPanelEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const summary = getEntrySummary(entry);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-md px-2.5 py-2 text-left",
        selected
          ? "bg-token-foreground/10"
          : "hover:bg-token-foreground/5",
        (entry.isUndone || !entry.reconstructable) && "opacity-55"
      )}
      aria-current={selected ? "true" : undefined}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium text-token-text-primary">
            {formatVersionListTimestamp(entry.timestamp)}
          </span>
          {entry.isUndone ? (
            <span className="shrink-0 text-[10px] uppercase tracking-normal text-token-description-foreground">
              undone
            </span>
          ) : null}
          {!entry.reconstructable ? (
            <span className="shrink-0 text-[10px] uppercase tracking-normal text-token-description-foreground">
              unavailable
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-token-description-foreground">
            {getOperationIcon(entry.operation)}
          </span>
          <span className="shrink-0 text-xs text-token-description-foreground">
            {getOperationLabel(entry.operation)}
          </span>
          {summary ? (
            <span className="min-w-0 truncate text-xs text-token-description-foreground">
              {summary}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export function HistoryEntryDetails({
  entry,
  selectedIndex,
  totalCount,
  onNavigate,
  onRevert,
  onRestore,
  actionInFlight,
  confirmingAction,
  onRequestConfirm,
  onCancelConfirm,
  actionError,
  showRestoreAction = true,
}: {
  entry: HistoryPanelEntry;
  selectedIndex: number;
  totalCount: number;
  onNavigate: (direction: -1 | 1) => void;
  onRevert: (entryId: number, operation: string) => void;
  onRestore: (entryId: number) => void;
  actionInFlight: "revert" | "restore" | null;
  confirmingAction: { type: "revert" | "restore"; entryId: number } | null;
  onRequestConfirm: (action: { type: "revert" | "restore"; entryId: number }) => void;
  onCancelConfirm: () => void;
  actionError: string | null;
  showRestoreAction?: boolean;
}) {
  const canGoPrev = selectedIndex > 0;
  const canGoNext = selectedIndex < totalCount - 1;
  const isActionable = entry.reconstructable && !entry.isUndone && entry.undoOf === null;
  const isConfirmingThis = confirmingAction?.entryId === entry.id;
  const showActionArea = isActionable && (showRestoreAction || confirmingAction?.type !== "restore");

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-(--foreground-secondary)">
              {getOperationIcon(entry.operation)}
            </span>
            <h4 className="text-sm font-medium text-(--foreground)">
              {getOperationLabel(entry.operation)}
            </h4>
            {entry.isUndone && (
              <span className="text-[10px] uppercase tracking-wide text-(--foreground-tertiary)">
                undone
              </span>
            )}
            {!entry.reconstructable ? (
              <span className="text-[10px] uppercase tracking-wide text-(--foreground-tertiary)">
                unavailable
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-(--foreground-tertiary)">
            {formatAbsoluteTimestamp(entry.timestamp)}
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onNavigate(-1)}
            disabled={!canGoPrev}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md",
              canGoPrev
                ? "text-(--foreground-secondary) hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]"
                : "cursor-not-allowed text-(--foreground-disabled)"
            )}
            aria-label="Previous history entry"
          >
            <ChevronLeft className="icon-2xs" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate(1)}
            disabled={!canGoNext}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md",
              canGoNext
                ? "text-(--foreground-secondary) hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]"
                : "cursor-not-allowed text-(--foreground-disabled)"
            )}
            aria-label="Next history entry"
          >
            <ChevronRight className="icon-2xs" />
          </button>
        </div>
      </div>

      {/* Actions */}
      {showActionArea && (
        <div>
          {isConfirmingThis ? (
            <div className="space-y-2">
              <p className="text-xs text-(--foreground-secondary)">
                {confirmingAction.type === "revert"
                  ? getRevertConfirmMessage(entry)
                  : `Restore card to the state at ${formatAbsoluteTimestamp(entry.timestamp)}?`}
              </p>
              {actionError && (
                <p className="text-xs text-(--priority-critical-text)">{actionError}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={actionInFlight !== null}
                  onClick={() => {
                    if (confirmingAction.type === "revert") {
                      onRevert(entry.id, entry.operation);
                    } else {
                      onRestore(entry.id);
                    }
                  }}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium",
                    entry.operation === "create" && confirmingAction.type === "revert"
                      ? "bg-(--priority-critical-bg) text-(--priority-critical-text) hover:opacity-90"
                      : "bg-(--accent-blue) text-white hover:opacity-90",
                    actionInFlight !== null && "cursor-not-allowed opacity-50"
                  )}
                >
                  {actionInFlight !== null ? "Working..." : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={onCancelConfirm}
                  disabled={actionInFlight !== null}
                  className="rounded-md px-2.5 py-1 text-xs text-(--foreground-secondary) hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onRequestConfirm({ type: "revert", entryId: entry.id })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  "bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]",
                  "text-(--foreground-secondary) hover:bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)]"
                )}
              >
                {getRevertLabel(entry.operation)}
              </button>
              {showRestoreAction ? (
                <button
                  type="button"
                  onClick={() => onRequestConfirm({ type: "restore", entryId: entry.id })}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium",
                    "bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]",
                    "text-(--foreground-secondary) hover:bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)]"
                  )}
                >
                  Restore to this point
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}

      {!entry.reconstructable ? (
        <div className="rounded-md bg-token-foreground/5 px-3 py-2 text-xs text-token-description-foreground">
          {entry.reconstructionUnavailableReason ?? "This version is unavailable."}
        </div>
      ) : null}

      {entry.operation === "update" && <UpdateDetails entry={entry} />}
      {entry.operation === "move" && <MoveDetails entry={entry} />}
      {(entry.operation === "create" || entry.operation === "delete") && <SnapshotDetails entry={entry} />}

      <details className="rounded-md bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)]">
        <summary className="cursor-pointer px-3 py-1.5 text-xs text-(--foreground-tertiary) select-none">
          Raw payload
        </summary>
        <pre className="overflow-x-auto px-3 pb-2 text-xs wrap-break-word whitespace-pre-wrap text-(--foreground-tertiary)">
          {JSON.stringify(entry, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function UpdateDetails({ entry }: { entry: HistoryPanelEntry }) {
  const fieldChanges = entry.fieldChanges ?? [];
  const descriptionChange = entry.descriptionChange ?? null;

  if (fieldChanges.length === 0 && !descriptionChange) {
    return (
      <div className="py-2 text-xs text-(--foreground-tertiary)">
        No field-level diff was recorded for this update.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {descriptionChange && (
        <DescriptionDeltaSection change={descriptionChange} />
      )}
      {fieldChanges.length > 0 && (
        <div className="divide-y divide-[0.5px] divide-(--border) rounded-lg bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)]">
          {fieldChanges.map((change) => (
            <div key={change.field} className="px-3 py-2.5">
              <div className="mb-1.5 text-xs font-medium text-(--foreground-secondary)">
                {formatFieldLabel(change.field)}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <DiffValue sign="−" value={change.before} emptyText="Not set" />
                <DiffValue sign="+" value={change.after} emptyText="Cleared" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MoveDetails({ entry }: { entry: HistoryPanelEntry }) {
  const fromColumn = getColumnLabel(entry.move?.fromStatus ?? null);
  const toColumn = getColumnLabel(entry.move?.toStatus ?? null);

  return (
    <div className="grid grid-cols-2 gap-4 rounded-lg bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)] px-3 py-2.5">
      <div>
        <div className="mb-1 text-[11px] text-(--foreground-tertiary)">From</div>
        <div className="text-sm text-(--foreground)">{fromColumn}</div>
      </div>
      <div>
        <div className="mb-1 text-[11px] text-(--foreground-tertiary)">To</div>
        <div className="text-sm text-(--foreground)">{toColumn}</div>
      </div>
    </div>
  );
}

function SnapshotDetails({ entry }: { entry: HistoryPanelEntry }) {
  const snapshot = entry.snapshot ?? null;

  if (!snapshot) {
    return (
      <div className="py-2 text-xs text-(--foreground-tertiary)">
        Snapshot data is unavailable for this entry.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {snapshot.description && (
        <DescriptionSnapshotSection
          label={entry.operation === "create" ? "Initial description" : "Deleted description"}
          snapshot={snapshot.description}
        />
      )}
      {(snapshot.fields ?? []).length > 0 && (
        <div className="divide-y divide-[0.5px] divide-(--border) rounded-lg bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)]">
          {(snapshot.fields ?? []).map((field) => (
            <div key={field.field} className="px-3 py-2">
              <div className="mb-1 text-xs font-medium text-(--foreground-tertiary)">
                {formatFieldLabel(field.field)}
              </div>
              <HistoryValue value={field.value} emptyText="Not set" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DescriptionDeltaSection({
  change,
  defaultFullDiffOpen = false,
}: {
  change: HistoryPanelDescriptionDelta;
  defaultFullDiffOpen?: boolean;
}) {
  const counts = countBlockChanges(change.blocks);
  const hasFullBeforeAfter = typeof change.beforeFullText === "string" && typeof change.afterFullText === "string";

  return (
    <article className="overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)]">
      <header className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h5 className="text-xs font-medium text-(--foreground-secondary)">
            Description
          </h5>
          <div className="flex flex-wrap items-center gap-1">
            <DescriptionMetric label="Before" value={`${change.beforeBlockCount}`} />
            <DescriptionMetric label="After" value={`${change.afterBlockCount}`} />
            {counts.replaced > 0 && (
              <DescriptionMetric label="Replaced" value={String(counts.replaced)} />
            )}
            {counts.added > 0 && (
              <DescriptionMetric label="Added" value={String(counts.added)} />
            )}
            {counts.removed > 0 && (
              <DescriptionMetric label="Removed" value={String(counts.removed)} />
            )}
          </div>
        </div>
      </header>

      {change.blocks.length === 0 ? (
        <div className="px-3 pb-2 text-xs text-(--foreground-tertiary)">
          No top-level block changes were recorded.
        </div>
      ) : (
        <div className="space-y-1.5 px-3 pb-3">
          {change.blocks.map((block, index) => (
            <DescriptionDeltaBlockCard key={`${block.changeType}-${index}`} block={block} />
          ))}
        </div>
      )}

      {hasFullBeforeAfter && (
        <DescriptionFullDiffDisclosure
          beforeText={change.beforeFullText ?? ""}
          afterText={change.afterFullText ?? ""}
          defaultOpen={defaultFullDiffOpen}
        />
      )}
    </article>
  );
}

export function DescriptionFullDiffDisclosure({
  beforeText,
  afterText,
  defaultOpen = false,
}: {
  beforeText: string;
  afterText: string;
  defaultOpen?: boolean;
}) {
  const { resolved } = useTheme();
  const [isExpanded, setIsExpanded] = useState(defaultOpen);
  const diffOptions = useMemo(() => getNodexDiffOptions(resolved, true), [resolved]);
  const diffHostStyle = useMemo(() => getNodexDiffHostStyle(resolved), [resolved]);
  const oldFile = useMemo(
    () => ({
      name: "description.md",
      contents: beforeText,
    }),
    [beforeText],
  );
  const newFile = useMemo(
    () => ({
      name: "description.md",
      contents: afterText,
    }),
    [afterText],
  );

  return (
    <details
      open={isExpanded}
      onToggle={(event) => setIsExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer px-3 py-1.5 text-xs text-(--foreground-tertiary) select-none">
        Full description diff
      </summary>
      {isExpanded ? (
        <div className="px-3 pb-3">
          <MultiFileDiff
            oldFile={oldFile}
            newFile={newFile}
            className={`${NODEX_DIFF_HOST_CLASS} max-h-[26rem] overflow-y-auto rounded-md border border-[0.5px] border-(--border)`}
            style={diffHostStyle}
            options={diffOptions}
          />
        </div>
      ) : null}
    </details>
  );
}

function DescriptionSnapshotSection({
  label,
  snapshot,
}: {
  label: string;
  snapshot: HistoryPanelDescriptionSnapshot;
}) {
  return (
    <article className="overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)]">
      <header className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h5 className="text-xs font-medium text-(--foreground-secondary)">
            {label}
          </h5>
          <DescriptionMetric label="Blocks" value={`${snapshot.blockCount}`} />
        </div>
      </header>

      {snapshot.blocks.length === 0 ? (
        <div className="px-3 pb-2 text-xs text-(--foreground-tertiary)">No description blocks.</div>
      ) : (
        <div className="space-y-1.5 px-3 pb-3">
          {snapshot.blocks.map((block) => (
            <DescriptionSnapshotBlockCard key={block.ordinal} block={block} />
          ))}
        </div>
      )}
    </article>
  );
}

function DescriptionDeltaBlockCard({
  block,
}: {
  block: HistoryPanelDescriptionDeltaBlock;
}) {
  const beforeLabel = getBlockOrdinalLabel(block.beforeOrdinal);
  const afterLabel = getBlockOrdinalLabel(block.afterOrdinal);

  return (
    <article className="overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)]">
      <div className="flex flex-wrap items-center gap-1 px-2.5 py-1.5">
        <DescriptionChangeBadge value={block.changeType} />
        <span className="text-[11px] text-(--foreground-tertiary)">{formatBlockTypeLabel(block.blockType)}</span>
        {beforeLabel && <span className="text-[11px] text-(--foreground-tertiary)">#{beforeLabel}</span>}
        {afterLabel && <span className="text-[11px] text-(--foreground-tertiary)">&rarr; #{afterLabel}</span>}
      </div>

      {block.changeType === "replaced" ? (
        <div className="grid grid-cols-2 gap-3 px-2.5 pb-2">
          <BlockPreviewPane sign="−" preview={block.beforePreview} nfm={block.beforeNfm} />
          <BlockPreviewPane sign="+" preview={block.afterPreview} nfm={block.afterNfm} />
        </div>
      ) : (
        <div className="px-2.5 pb-2">
          <BlockPreviewPane
            preview={block.afterPreview ?? block.beforePreview}
            nfm={block.afterNfm ?? block.beforeNfm}
          />
        </div>
      )}
    </article>
  );
}

function DescriptionSnapshotBlockCard({
  block,
}: {
  block: HistoryPanelDescriptionSnapshotBlock;
}) {
  return (
    <article className="overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)]">
      <div className="flex flex-wrap items-center gap-1 px-2.5 py-1.5">
        <span className="text-[11px] text-(--foreground-tertiary)">#{block.ordinal + 1}</span>
        <span className="text-[11px] text-(--foreground-tertiary)">{formatBlockTypeLabel(block.blockType)}</span>
      </div>
      <div className="px-2.5 pb-2">
        <BlockPreviewPane preview={block.preview} nfm={block.nfm} />
      </div>
    </article>
  );
}

function BlockPreviewPane({
  sign,
  preview,
  nfm,
}: {
  sign?: "−" | "+";
  preview: string | null;
  nfm: string | null;
}) {
  if (!preview) {
    return (
      <div className="flex gap-1.5">
        {sign && <DiffSign sign={sign} />}
        <span className="text-sm text-(--foreground-tertiary)">No block content</span>
      </div>
    );
  }

  return (
    <div>
      <p className="flex gap-1.5 text-sm/6 wrap-break-word text-(--foreground-secondary)">
        {sign && <DiffSign sign={sign} />}
        <span>{preview}</span>
      </p>
      {nfm && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-(--foreground-tertiary) select-none">
            Source
          </summary>
          <pre className="mt-1 text-xs/5 wrap-break-word whitespace-pre-wrap text-(--foreground-tertiary)">
            {nfm}
          </pre>
        </details>
      )}
    </div>
  );
}

function DescriptionMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[11px] text-(--foreground-tertiary)">
      <span className="mr-0.5">{label}</span>
      <span className="text-(--foreground-secondary)">{value}</span>
    </span>
  );
}

function DiffSign({ sign }: { sign: "−" | "+" }) {
  return (
    <span
      className={cn(
        "shrink-0 text-xs font-medium leading-6",
        sign === "−" ? "text-(--priority-critical-text)" : "text-(--green-text)",
      )}
    >
      {sign}
    </span>
  );
}

function DiffValue({ sign, value, emptyText }: { sign: "−" | "+"; value: unknown; emptyText: string }) {
  return (
    <div className="flex gap-1.5">
      <DiffSign sign={sign} />
      <HistoryValue value={value} emptyText={emptyText} />
    </div>
  );
}

function DescriptionChangeBadge({
  value,
}: {
  value: HistoryPanelDescriptionDeltaBlock["changeType"];
}) {
  const label = value[0]?.toUpperCase() + value.slice(1);
  const className = value === "added"
    ? "bg-(--green-bg) text-(--green-text)"
    : value === "removed"
      ? "bg-[color-mix(in_srgb,var(--priority-critical-text)_12%,transparent)] text-(--priority-critical-text)"
      : "bg-[color-mix(in_srgb,var(--accent-blue)_16%,transparent)] text-(--accent-blue)";

  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", className)}>
      {label}
    </span>
  );
}

function HistoryValue({ value, emptyText }: { value: unknown; emptyText: string }) {
  const normalized = normalizeHistoryValue(value);

  if (!normalized) {
    return <span className="text-sm text-(--foreground-tertiary)">{emptyText}</span>;
  }

  if (normalized.multiline) {
    return (
      <pre className="text-xs/5 wrap-break-word whitespace-pre-wrap text-(--foreground-secondary)">
        {normalized.text}
      </pre>
    );
  }

  return (
    <span className="text-sm wrap-break-word text-(--foreground)">
      {normalized.text}
    </span>
  );
}

function normalizeHistoryPanelEntry(entry: HistoryPanelEntry): HistoryPanelEntry {
  const raw = entry as HistoryPanelEntry & {
    previousValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
    cardSnapshot?: Record<string, unknown> | null;
  };

  const fieldChanges = Array.isArray(entry.fieldChanges)
    ? entry.fieldChanges
    : buildFallbackFieldChanges(raw.previousValues, raw.newValues);
  const descriptionChange = entry.descriptionChange ?? null;
  const snapshot = entry.snapshot ?? buildFallbackSnapshot(raw.cardSnapshot);

  return {
    ...entry,
    summary: entry.summary ?? null,
    fieldChanges,
    move: entry.move ?? null,
    descriptionChange,
    snapshot,
    reconstructable: entry.reconstructable ?? true,
    reconstructionUnavailableReason: entry.reconstructionUnavailableReason ?? null,
  };
}

function buildFallbackFieldChanges(
  previousValues: Record<string, unknown> | null | undefined,
  newValues: Record<string, unknown> | null | undefined,
) {
  const previous = previousValues ?? {};
  const next = newValues ?? {};
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter((field) => field !== "description")
    .sort((left, right) => left.localeCompare(right));

  return keys.map((field) => ({
    field,
    before: previous[field],
    after: next[field],
  }));
}

function buildFallbackSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
) {
  if (!snapshot) return null;

  const fields = Object.entries(snapshot)
    .filter(([field]) => field !== "description")
    .map(([field, value]) => ({ field, value }));

  return {
    fields,
    description: null,
  };
}

// --- Action helpers ---

function getRevertLabel(op: string): string {
  switch (op) {
    case "update": return "Revert update";
    case "move": return "Revert move";
    case "create": return "Delete this card";
    case "delete": return "Restore card";
    default: return "Revert";
  }
}

function getRevertConfirmMessage(entry: HistoryPanelEntry): string {
  switch (entry.operation) {
    case "update": return "Revert this update? The changed fields will be restored to their previous values.";
    case "move": return `Revert this move? The card will be moved back to ${getColumnLabel(entry.move?.fromStatus ?? null)}.`;
    case "create": return "This will delete the card. This action creates a history entry and can be reversed.";
    case "delete": return "Restore this deleted card? It will be re-created from the saved snapshot.";
    default: return "Are you sure?";
  }
}

// --- Formatting helpers ---

function getOperationLabel(op: string): string {
  switch (op) {
    case "create":
      return "Created";
    case "delete":
      return "Deleted";
    case "move":
      return "Moved";
    case "update":
      return "Updated";
    default:
      return op;
  }
}

function getOperationIcon(op: string) {
  switch (op) {
    case "create":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      );
    case "delete":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      );
    case "move":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      );
    case "update":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      );
    default:
      return null;
  }
}

function getEntrySummary(entry: HistoryPanelEntry): string | null {
  if (entry.operation === "move") {
    return `${getColumnLabel(entry.move?.fromStatus ?? null)} \u2192 ${getColumnLabel(entry.move?.toStatus ?? null)}`;
  }

  const fieldChanges = entry.fieldChanges ?? [];
  if (entry.operation === "update" && fieldChanges.length === 1 && !entry.descriptionChange) {
    return `Changed ${formatFieldLabel(fieldChanges[0]?.field ?? "field").toLowerCase()}`;
  }

  return entry.summary;
}

function collectCardPreviewProperties(card: Card): Array<{ label: string; value: string }> {
  const properties: Array<{ label: string; value: string }> = [
    { label: "Status", value: getColumnLabel(card.status) },
  ];

  if (card.archived) properties.push({ label: "Archive", value: "Archived" });
  if (card.priority) properties.push({ label: "Priority", value: formatFieldValue(card.priority) });
  if (card.estimate) properties.push({ label: "Estimate", value: formatFieldValue(card.estimate) });
  if (card.assignee) properties.push({ label: "Assignee", value: card.assignee });
  if (card.agentStatus) properties.push({ label: "Agent status", value: card.agentStatus });
  if (card.tags.length > 0) properties.push({ label: "Tags", value: card.tags.join(", ") });
  if (card.dueDate) properties.push({ label: "Due", value: formatCardDate(card.dueDate) });
  if (card.scheduledStart) {
    const schedule = card.scheduledEnd
      ? `${formatCardDate(card.scheduledStart)} - ${formatCardDate(card.scheduledEnd)}`
      : formatCardDate(card.scheduledStart);
    properties.push({ label: "Schedule", value: schedule });
  }
  if (card.runInTarget && card.runInTarget !== "localProject") {
    properties.push({ label: "Run in", value: formatFieldValue(card.runInTarget) });
  }

  return properties;
}

function formatFieldValue(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatCardDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return field.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function formatBlockTypeLabel(blockType: string): string {
  return blockType.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function getColumnLabel(columnId: string | null): string {
  if (!columnId) return "Unknown column";
  return COLUMN_LABELS[columnId] ?? columnId;
}

function formatVersionListTimestamp(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAbsoluteTimestamp(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function normalizeHistoryValue(
  value: unknown
): { text: string; multiline: boolean } | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "boolean") {
    return { text: value ? "Yes" : "No", multiline: false };
  }

  if (typeof value === "number") {
    return { text: String(value), multiline: false };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return { text: value.map((item) => String(item)).join(", "), multiline: false };
  }

  if (typeof value === "string") {
    const formattedDate = formatMaybeDate(value);
    const text = formattedDate ?? value;
    return { text, multiline: text.includes("\n") || text.length > 120 };
  }

  if (typeof value === "object") {
    const text = JSON.stringify(value, null, 2);
    return { text, multiline: true };
  }

  return { text: String(value), multiline: false };
}

function formatMaybeDate(value: string): string | null {
  const isDateLike = /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value);
  if (!isDateLike) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function countBlockChanges(
  blocks: HistoryPanelDescriptionDelta["blocks"],
): Record<"added" | "removed" | "replaced", number> {
  return blocks.reduce(
    (counts, block) => {
      counts[block.changeType] += 1;
      return counts;
    },
    { added: 0, removed: 0, replaced: 0 },
  );
}

function getBlockOrdinalLabel(ordinal: number | null): string | null {
  if (ordinal === null || ordinal < 0) return null;
  return `#${ordinal + 1}`;
}
