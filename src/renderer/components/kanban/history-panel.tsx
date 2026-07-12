import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  FileClock,
  GitCommitHorizontal,
  History,
  Route,
  ShieldCheck,
  XIcon,
} from "lucide-react";

import { NodexButton } from "@/components/ui/button";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useMutationAuditSessionId } from "@/lib/mutation-audit-session";
import {
  CARD_HISTORY_CONTRACT_VERSION,
  DEFAULT_CARD_HISTORY_PAGE_SIZE,
  type CardHistoryCursor,
  type CardHistoryEntry,
} from "../../../shared/card-history";
import {
  DOCUMENT_VERSION_CONTRACT_VERSION,
  type DocumentVersionDetail,
  type PrepareDocumentVersionRestore,
} from "../../../shared/block-documents/document-history";
import { ReadonlyNfmBlockNotePreview } from "./editor/readonly-nfm-blocknote-preview";
import { mergeCardHistoryEntries } from "./card-history-view-model";
import {
  getDocumentVersion,
  getOwnedDocumentDescriptor,
  listCardHistory,
  restoreDocumentVersion,
} from "./history-panel-deps";

type HistoryFilter = "all" | "checkpoint" | "change" | "relocation";

const HISTORY_FILTERS: ReadonlyArray<{
  readonly value: HistoryFilter;
  readonly label: string;
}> = [
  { value: "all", label: "All" },
  { value: "checkpoint", label: "Checkpoints" },
  { value: "change", label: "Changes" },
  { value: "relocation", label: "Moves" },
];

interface HistoryPanelProps {
  projectId: string;
  cardId: string | null;
  cardTitle?: string;
  projectWorkspacePath?: string | null;
  open: boolean;
  onClose: () => void;
  onCardMutated?: () => void;
}

const matchesFilter = (
  entry: CardHistoryEntry,
  filter: HistoryFilter,
): boolean => {
  if (filter === "all") return true;
  if (filter === "checkpoint") return entry.kind === "document_version";
  if (filter === "relocation") return entry.kind === "block_relocation";
  return entry.kind === "block_mutation";
};

export function HistoryPanel({
  projectId,
  cardId,
  cardTitle,
  projectWorkspacePath,
  open,
  onClose,
  onCardMutated,
}: HistoryPanelProps) {
  const auditSessionId = useMutationAuditSessionId();
  const requestSerialRef = useRef(0);
  const restoreInFlightRef = useRef(false);
  const pendingRestoreRef = useRef<{
    readonly entryId: string;
    readonly request: PrepareDocumentVersionRestore;
  } | null>(null);
  const [entries, setEntries] = useState<readonly CardHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<CardHistoryCursor | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<
    ReadonlyMap<string, DocumentVersionDetail>
  >(() => new Map());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const loadFirstPage = useCallback(async (targetCardId: string) => {
    const requestSerial = requestSerialRef.current + 1;
    requestSerialRef.current = requestSerial;
    setLoading(true);
    setLoadingOlder(false);
    setTimelineError(null);
    setEntries([]);
    setNextCursor(null);
    setSelectedEntryId(null);
    setPreviewCache(new Map());
    try {
      const result = await listCardHistory({
        version: CARD_HISTORY_CONTRACT_VERSION,
        projectId,
        cardBlockId: targetCardId,
        pageSize: DEFAULT_CARD_HISTORY_PAGE_SIZE,
      });
      if (requestSerial !== requestSerialRef.current) return;
      if (!result.ok) {
        setEntries([]);
        setNextCursor(null);
        setTimelineError(result.error.message);
        return;
      }
      setEntries(result.value.entries);
      setNextCursor(result.value.nextCursor);
      setSelectedEntryId((current) => {
        if (current && result.value.entries.some((entry) => entry.id === current)) {
          return current;
        }
        return result.value.entries[0]?.id ?? null;
      });
    } catch (error) {
      if (requestSerial !== requestSerialRef.current) return;
      setEntries([]);
      setNextCursor(null);
      setTimelineError(toErrorMessage(error, "Couldn’t load Card history."));
    } finally {
      if (requestSerial === requestSerialRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open || !cardId) return;
    void loadFirstPage(cardId);
  }, [cardId, loadFirstPage, open]);

  useEffect(() => {
    if (open) return;
    requestSerialRef.current += 1;
    setEntries([]);
    setNextCursor(null);
    setSelectedEntryId(null);
    setFilter("all");
    setTimelineError(null);
    setPreviewCache(new Map());
    setPreviewError(null);
    setConfirmingRestore(false);
    setRestoreError(null);
    pendingRestoreRef.current = null;
  }, [open]);

  const filteredEntries = useMemo(
    () => entries.filter((entry) => matchesFilter(entry, filter)),
    [entries, filter],
  );

  useEffect(() => {
    if (filteredEntries.some((entry) => entry.id === selectedEntryId)) return;
    setSelectedEntryId(filteredEntries[0]?.id ?? null);
  }, [filteredEntries, selectedEntryId]);

  const selectedIndex = filteredEntries.findIndex(
    (entry) => entry.id === selectedEntryId,
  );
  const selectedEntry =
    selectedIndex < 0 ? null : filteredEntries[selectedIndex] ?? null;
  const selectedPreview = selectedEntry
    ? previewCache.get(selectedEntry.id) ?? null
    : null;

  useEffect(() => {
    setConfirmingRestore(false);
    setRestoreError(null);
    pendingRestoreRef.current = null;
    if (!selectedEntry || selectedEntry.kind !== "document_version") {
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }
    if (previewCache.has(selectedEntry.id)) {
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    void getDocumentVersion({
      projectId,
      documentId: selectedEntry.documentId,
      versionId: selectedEntry.versionMetadata.versionId,
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPreviewError(result.error.message);
        return;
      }
      setPreviewCache((current) => {
        const next = new Map(current);
        next.set(selectedEntry.id, result.value);
        return next;
      });
    }).catch((error: unknown) => {
      if (cancelled) return;
      setPreviewError(toErrorMessage(error, "Checkpoint preview is unavailable."));
    }).finally(() => {
      if (!cancelled) setPreviewLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [previewCache, projectId, selectedEntry]);

  const navigate = useCallback((direction: -1 | 1) => {
    if (filteredEntries.length === 0) return;
    const currentIndex = filteredEntries.findIndex(
      (entry) => entry.id === selectedEntryId,
    );
    const nextIndex = currentIndex < 0
      ? 0
      : Math.min(
          filteredEntries.length - 1,
          Math.max(0, currentIndex + direction),
        );
    setSelectedEntryId(filteredEntries[nextIndex]?.id ?? null);
  }, [filteredEntries, selectedEntryId]);

  const handleTimelineKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      navigate(1);
      return;
    }
    if (event.key !== "ArrowUp") return;
    event.preventDefault();
    navigate(-1);
  }, [navigate]);

  const handleLoadOlder = useCallback(async () => {
    if (!cardId || !nextCursor || loadingOlder) return;
    const cursor = nextCursor;
    const requestSerial = requestSerialRef.current;
    setLoadingOlder(true);
    setTimelineError(null);
    try {
      const result = await listCardHistory({
        version: CARD_HISTORY_CONTRACT_VERSION,
        projectId,
        cardBlockId: cardId,
        before: cursor,
        pageSize: DEFAULT_CARD_HISTORY_PAGE_SIZE,
      });
      if (requestSerial !== requestSerialRef.current) return;
      if (!result.ok) {
        setTimelineError(result.error.message);
        return;
      }
      setEntries((current) => mergeCardHistoryEntries(current, result.value.entries));
      setNextCursor(result.value.nextCursor);
    } catch (error) {
      if (requestSerial !== requestSerialRef.current) return;
      setTimelineError(toErrorMessage(error, "Couldn’t load earlier history."));
    } finally {
      if (requestSerial === requestSerialRef.current) setLoadingOlder(false);
    }
  }, [cardId, loadingOlder, nextCursor, projectId]);

  const handleRestore = useCallback(async () => {
    if (
      restoreInFlightRef.current ||
      !cardId ||
      !selectedEntry ||
      selectedEntry.recovery.kind !== "restore_document_version"
    ) {
      return;
    }
    restoreInFlightRef.current = true;
    setRestoring(true);
    setRestoreError(null);
    try {
      let pendingRestore = pendingRestoreRef.current;
      if (!pendingRestore || pendingRestore.entryId !== selectedEntry.id) {
        const descriptor = await getOwnedDocumentDescriptor(projectId, cardId);
        if (descriptor.readiness !== "ready") {
          throw new Error("This Card must finish syncing before it can be restored.");
        }
        if (descriptor.documentId !== selectedEntry.recovery.documentId) {
          throw new Error("This checkpoint no longer belongs to the Card document.");
        }
        pendingRestore = {
          entryId: selectedEntry.id,
          request: {
            version: DOCUMENT_VERSION_CONTRACT_VERSION,
            mutationId: crypto.randomUUID(),
            projectId,
            storeEpoch: descriptor.storeEpoch,
            documentId: descriptor.documentId,
            versionId: selectedEntry.recovery.versionId,
            generation: descriptor.generation,
            expectedHeadSeq: descriptor.headSeq,
            clientSessionId: auditSessionId,
            actor: { kind: "renderer_history_restore" },
          },
        };
        pendingRestoreRef.current = pendingRestore;
      }

      const commit = () => restoreDocumentVersion(
        projectId,
        pendingRestore.request.documentId,
        pendingRestore.request,
      );
      let result;
      let retried = false;
      try {
        result = await commit();
      } catch {
        retried = true;
        result = await commit();
      }
      if (!result.ok && result.error.retryable && !retried) {
        result = await commit();
      }
      if (!result.ok) {
        if (!result.error.retryable) pendingRestoreRef.current = null;
        throw new Error(result.error.message);
      }
      pendingRestoreRef.current = null;
      setConfirmingRestore(false);
      onCardMutated?.();
      await loadFirstPage(cardId);
    } catch (error) {
      setRestoreError(toErrorMessage(error, "Couldn’t restore this checkpoint."));
    } finally {
      restoreInFlightRef.current = false;
      setRestoring(false);
    }
  }, [
    auditSessionId,
    cardId,
    loadFirstPage,
    onCardMutated,
    projectId,
    selectedEntry,
  ]);

  if (!open) return null;

  const previewTitle =
    selectedPreview?.materialization.kind === "card"
      ? selectedPreview.materialization.title
      : cardTitle;

  return (
    <NodexDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <NodexDialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        overlayClassName="bg-black/55"
        style={{
          width: "min(94vw, 1180px)",
          maxWidth: "calc(100vw - 1.5rem)",
          height: "min(88vh, 760px)",
        }}
        className={cn(
          "grid max-w-none grid-cols-1 gap-0 overflow-hidden rounded-xl p-0 sm:max-w-none",
          "md:grid-cols-[minmax(0,1fr)_20rem]",
        )}
      >
        <NodexDialogTitle className="sr-only">Card history</NodexDialogTitle>

        <section className="flex min-h-0 min-w-0 flex-col bg-token-main-surface-primary">
          <header className="flex h-11 shrink-0 items-center gap-2 border-b-[0.5px] border-token-border px-3">
            <History className="icon-2xs shrink-0 text-token-description-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-token-text-secondary">
              {previewTitle ?? cardTitle ?? "Untitled Card"}
            </span>
            {selectedEntry ? (
              <time
                dateTime={selectedEntry.occurredAt}
                className="hidden shrink-0 text-xs text-token-description-foreground sm:block"
              >
                {formatAbsoluteTimestamp(selectedEntry.occurredAt)}
              </time>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {loading ? (
              <HistoryEmptyState>Loading Card history…</HistoryEmptyState>
            ) : timelineError && entries.length === 0 ? (
              <HistoryEmptyState>{timelineError}</HistoryEmptyState>
            ) : entries.length === 0 ? (
              <HistoryEmptyState>No durable history for this Card yet.</HistoryEmptyState>
            ) : selectedEntry ? (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                {selectedEntry.kind === "document_version" ? (
                  <CheckpointPreview
                    entry={selectedEntry}
                    detail={selectedPreview}
                    loading={previewLoading}
                    error={previewError}
                    fallbackTitle={cardTitle}
                    projectWorkspacePath={projectWorkspacePath}
                  />
                ) : (
                  <HistoryTimelineDetails entry={selectedEntry} />
                )}
              </div>
            ) : (
              <HistoryEmptyState>Select an event to inspect its evidence.</HistoryEmptyState>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-l-[0.5px] border-token-border bg-token-bg-fog/70 max-md:border-t-[0.5px] max-md:border-l-0">
          <header className="flex shrink-0 items-start gap-2 px-3 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-medium text-token-text-primary">
                Card history
              </h2>
              <p className="mt-0.5 truncate text-xs text-token-description-foreground">
                Checkpoints and committed events
              </p>
            </div>
            <NodexButton
              type="button"
              variant="ghost"
              size="icon-xs"
              className="rounded-full text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-text-primary"
              aria-label="Close Card history"
              onClick={onClose}
            >
              <XIcon className="icon-2xs shrink-0" />
            </NodexButton>
          </header>

          <div className="flex shrink-0 flex-wrap gap-1 px-2 pb-2">
            {HISTORY_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs",
                  filter === item.value
                    ? "bg-token-foreground/10 text-token-text-primary"
                    : "text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-text-secondary",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
            onKeyDown={handleTimelineKeyDown}
          >
            {filteredEntries.map((entry) => (
              <HistoryEntryRow
                key={entry.id}
                entry={entry}
                selected={entry.id === selectedEntry?.id}
                onSelect={() => setSelectedEntryId(entry.id)}
              />
            ))}
            {filteredEntries.length === 0 ? (
              <p className="px-2 py-3 text-xs text-token-description-foreground">
                No events in this category.
              </p>
            ) : null}
            {nextCursor ? (
              <button
                type="button"
                disabled={loadingOlder}
                onClick={() => void handleLoadOlder()}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-text-secondary disabled:opacity-40"
              >
                <ChevronDown className="icon-2xs shrink-0" />
                {loadingOlder ? "Loading…" : "Load earlier"}
              </button>
            ) : null}
            {timelineError && entries.length > 0 ? (
              <p role="alert" className="px-2 py-2 text-xs text-(--priority-critical-text)">
                {timelineError}
              </p>
            ) : null}
          </div>

          <HistoryRecoveryFooter
            entry={selectedEntry}
            confirming={confirmingRestore}
            restoring={restoring}
            error={restoreError}
            onRequestRestore={() => setConfirmingRestore(true)}
            onCancel={() => {
              setConfirmingRestore(false);
              setRestoreError(null);
            }}
            onConfirm={() => void handleRestore()}
          />
        </aside>
      </NodexDialogContent>
    </NodexDialog>
  );
}

function CheckpointPreview({
  entry,
  detail,
  loading,
  error,
  fallbackTitle,
  projectWorkspacePath,
}: {
  entry: Extract<CardHistoryEntry, { kind: "document_version" }>;
  detail: DocumentVersionDetail | null;
  loading: boolean;
  error: string | null;
  fallbackTitle?: string;
  projectWorkspacePath?: string | null;
}) {
  if (loading && !detail) {
    return <HistoryEmptyState>Loading checkpoint preview…</HistoryEmptyState>;
  }
  if (error && !detail) return <HistoryEmptyState>{error}</HistoryEmptyState>;
  if (!detail) return <HistoryEmptyState>Checkpoint preview is unavailable.</HistoryEmptyState>;

  const materialization = detail.materialization;
  if (materialization.kind === "canvas_scene") {
    return (
      <HistoryTimelineDetails entry={entry}>
        Scene checkpoint · {materialization.elements.length} elements
      </HistoryTimelineDetails>
    );
  }

  const title = materialization.kind === "card"
    ? materialization.title
    : fallbackTitle ?? "Document checkpoint";
  return (
    <article className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-token-description-foreground">
        <span>{entry.versionMetadata.label ?? entry.versionMetadata.cause}</span>
        <span>{formatBytes(entry.versionMetadata.byteLength)}</span>
        <span className="font-mono tabular-nums">
          {entry.versionMetadata.checkpointHash.slice(0, 10)}
        </span>
      </div>
      <h2 className="wrap-break-word text-xl/snug-plus font-semibold tracking-normal text-token-text-primary">
        {title || "Untitled Card"}
      </h2>
      <div className="mt-5 min-h-32">
        {materialization.nfm.trim() ? (
          <ReadonlyNfmBlockNotePreview
            content={materialization.nfm}
            projectId={entry.projectId}
            cardId={entry.cardBlockId}
            historyId={entry.versionMetadata.versionId}
            projectWorkspacePath={projectWorkspacePath}
            className="text-token-text-primary"
          />
        ) : (
          <p className="text-sm text-token-description-foreground">Empty document</p>
        )}
      </div>
      <p className="mt-5 text-xs text-token-description-foreground">
        This checkpoint contains the Card title and body. Restoring creates a new
        forward change; it never rewinds the collaboration log.
      </p>
    </article>
  );
}

export function HistoryTimelineDetails({
  entry,
  children,
}: {
  entry: CardHistoryEntry;
  children?: ReactNode;
}) {
  const metadata = collectEntryMetadata(entry);
  return (
    <article className="min-w-0">
      <div className="flex items-start gap-2">
        <HistoryKindIcon entry={entry} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h2 className="wrap-break-word text-lg font-medium text-token-text-primary">
            {entry.display.title}
          </h2>
          {entry.display.detail ? (
            <p className="mt-1 text-sm text-token-text-secondary">
              {entry.display.detail}
            </p>
          ) : null}
        </div>
      </div>

      {children ? (
        <p className="mt-4 text-sm text-token-text-secondary">{children}</p>
      ) : null}

      <dl className="mt-5 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
        {metadata.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="truncate text-token-description-foreground">{label}</dt>
            <dd className="min-w-0 wrap-break-word text-token-text-secondary">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex items-start gap-2 rounded-lg bg-token-foreground/5 px-3 py-2.5 text-xs text-token-description-foreground">
        <ShieldCheck className="icon-2xs mt-0.5 shrink-0" />
        <p>
          {entry.evidence.status === "verified"
            ? "This is verified durable evidence. It does not define an inverse operation."
            : `Evidence is incomplete: ${formatEvidenceReason(entry.evidence.reason)}. This event cannot be reversed.`}
        </p>
      </div>
    </article>
  );
}

function HistoryRecoveryFooter({
  entry,
  confirming,
  restoring,
  error,
  onRequestRestore,
  onCancel,
  onConfirm,
}: {
  entry: CardHistoryEntry | null;
  confirming: boolean;
  restoring: boolean;
  error: string | null;
  onRequestRestore: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!entry) return null;
  const recoverable = entry.recovery.kind === "restore_document_version";
  return (
    <footer className="shrink-0 border-t-[0.5px] border-token-border px-3 py-3">
      {error ? (
        <p role="alert" className="mb-2 text-xs text-(--priority-critical-text)">
          {error}
        </p>
      ) : null}
      {confirming && recoverable ? (
        <p className="mb-2 text-xs text-token-text-secondary">
          Restore this checkpoint as a new forward change?
        </p>
      ) : null}
      {!recoverable ? (
        <p className="text-xs text-token-description-foreground">
          {formatRecoveryUnavailable(entry)}
        </p>
      ) : (
        <div className="flex items-center justify-end gap-2">
          {confirming ? (
            <NodexButton
              type="button"
              variant="ghost"
              size="sm"
              disabled={restoring}
              onClick={onCancel}
            >
              Cancel
            </NodexButton>
          ) : null}
          <NodexButton
            type="button"
            size="sm"
            disabled={restoring}
            onClick={confirming ? onConfirm : onRequestRestore}
          >
            {restoring
              ? "Restoring…"
              : confirming
                ? "Confirm restore"
                : "Restore checkpoint"}
          </NodexButton>
        </div>
      )}
    </footer>
  );
}

function HistoryEntryRow({
  entry,
  selected,
  onSelect,
}: {
  entry: CardHistoryEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${entry.display.title}, ${formatAbsoluteTimestamp(entry.occurredAt)}`}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left",
        selected ? "bg-token-foreground/10" : "hover:bg-token-foreground/5",
      )}
    >
      <HistoryKindIcon entry={entry} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-token-text-primary">
          {entry.display.title}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-token-description-foreground">
          <span className="truncate">{formatEntryCategory(entry)}</span>
          <span aria-hidden="true">·</span>
          <time className="shrink-0" dateTime={entry.occurredAt}>
            {formatRelativeTimestamp(entry.occurredAt)}
          </time>
        </span>
      </span>
    </button>
  );
}

function HistoryKindIcon({
  entry,
  className,
}: {
  entry: CardHistoryEntry;
  className?: string;
}) {
  if (entry.kind === "document_version") {
    return <FileClock className={cn("icon-2xs shrink-0 text-token-description-foreground", className)} />;
  }
  if (entry.kind === "block_relocation") {
    return <Route className={cn("icon-2xs shrink-0 text-token-description-foreground", className)} />;
  }
  return <GitCommitHorizontal className={cn("icon-2xs shrink-0 text-token-description-foreground", className)} />;
}

function HistoryEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="py-10 text-center text-sm text-token-description-foreground">
      {children}
    </div>
  );
}

const collectEntryMetadata = (
  entry: CardHistoryEntry,
): ReadonlyArray<readonly [string, string]> => {
  const common: Array<readonly [string, string]> = [
    ["Committed", formatAbsoluteTimestamp(entry.occurredAt)],
  ];
  if (entry.display.actorLabel) common.push(["Actor", entry.display.actorLabel]);
  if (entry.kind === "document_version") {
    return [
      ...common,
      ["Cause", entry.versionMetadata.cause],
      ["Head", String(entry.versionMetadata.baseHeadSeq)],
      ["Schema", `${entry.versionMetadata.schemaKey}@${entry.versionMetadata.schemaVersion}`],
      ["Version", entry.versionMetadata.versionId],
    ];
  }
  if (entry.kind === "block_relocation") {
    return [
      ...common,
      ["Direction", formatDirection(entry.direction)],
      ["Blocks", formatOptionalCount(entry.movedBlockCount)],
      ["Relocation", entry.relocationId ?? "Ledger unavailable"],
      ["Change sequence", String(entry.changeSeq)],
    ];
  }
  return [
    ...common,
    ["Mutation", entry.mutationKind ?? "Unknown mutation"],
    ["Blocks", formatOptionalCount(entry.affectedBlockCount)],
    ["Field intents", formatOptionalCount(entry.fieldIntentCount)],
    ["Operation", entry.mutationId ?? "Ledger unavailable"],
    ["Change sequence", String(entry.changeSeq)],
  ];
};

const formatRecoveryUnavailable = (entry: CardHistoryEntry): string => {
  if (entry.recovery.kind !== "unavailable") return "";
  switch (entry.recovery.reason) {
    case "document_generation_changed":
      return "This checkpoint belongs to an earlier document generation and cannot be restored.";
    case "insufficient_evidence":
      return "There isn’t enough durable evidence to reconstruct this state.";
    case "no_inverse_contract":
      return "This committed event is evidence only; it has no inverse operation.";
  }
};

const formatEvidenceReason = (
  reason: Extract<CardHistoryEntry["evidence"], { status: "unavailable" }>["reason"],
): string => reason.replaceAll("_", " ");

const formatDirection = (
  direction: Extract<CardHistoryEntry, { kind: "block_relocation" }>["direction"],
): string => {
  switch (direction) {
    case "into_card":
      return "Into Card";
    case "out_of_card":
      return "Out of Card";
    case "within_card":
      return "Within Card";
    case "unknown":
      return "Unknown";
  }
};

const formatEntryCategory = (entry: CardHistoryEntry): string => {
  if (entry.kind === "document_version") return "Checkpoint";
  if (entry.kind === "block_relocation") return "Relocation";
  return entry.display.category === "unknown"
    ? "Mutation"
    : entry.display.category.charAt(0).toUpperCase() + entry.display.category.slice(1);
};

const formatOptionalCount = (value: number | null): string =>
  value === null ? "Unknown" : String(value);

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
};

const formatAbsoluteTimestamp = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatRelativeTimestamp = (value: string): string => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
};

const toErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback;
