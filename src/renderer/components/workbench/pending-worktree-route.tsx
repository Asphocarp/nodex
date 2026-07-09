import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  CodexSessionPinFilledIcon,
  CodexSessionPinIcon,
  SpinnerIcon,
  TextActionPencilSmallIcon,
} from "@/components/shared/icons";
import { NodexButton } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { UserMessageText } from "@/features/local-conversation/view/shared/user-message-collapse";
import { THREAD_VISUAL_TOKENS } from "@/features/local-conversation/view/blocks/local-conversation-visual-tokens";
import { WorktreeInitActivityList } from "@/features/local-conversation/view/shared/tools/worktree-init-activity-list";
import { invoke, subscribeCodexPendingWorktreesChanged } from "@/lib/api";
import { RenameChatDialog } from "./rename-chat-dialog";
import type {
  CodexPendingWorktreeEntry,
  CodexPendingWorktreeThreadResolution,
  CodexPendingWorktreesChangedEvent,
} from "../../../shared/codex-pending-worktree";
import type { CodexAgentMode } from "../../../shared/types";
import {
  resolvePendingWorktreeActivities,
  resolvePendingWorktreeRouteActions,
} from "./pending-worktree-route-model";

type PendingWorktreeRouteAction =
  | "auto-fix"
  | "cancel"
  | "continue"
  | "retry"
  | "work-locally";

export interface PendingWorktreeRouteTransport {
  list: () => Promise<readonly CodexPendingWorktreeEntry[]>;
  resolveThread: (
    clientThreadId: string,
  ) => Promise<CodexPendingWorktreeThreadResolution | null>;
  autoFix: (
    hostId: string,
    pendingWorktreeId: string,
    agentMode: CodexAgentMode,
  ) => Promise<import("../../../shared/codex-pending-worktree").CodexPendingWorktreeCreateResult>;
  retry: (hostId: string, pendingWorktreeId: string) => Promise<void>;
  workLocally: (hostId: string, pendingWorktreeId: string) => Promise<void>;
  continue: (hostId: string, pendingWorktreeId: string) => Promise<void>;
  cancel: (hostId: string, pendingWorktreeId: string) => Promise<void>;
  discardForkSidePanelTransfer: (pendingWorktreeId: string) => Promise<void>;
  rename: (hostId: string, pendingWorktreeId: string, label: string) => Promise<void>;
  setPinned: (
    hostId: string,
    pendingWorktreeId: string,
    isPinned: boolean,
  ) => Promise<void>;
  clearAttention: (hostId: string, pendingWorktreeId: string) => Promise<void>;
  subscribe: (
    listener: (entries: CodexPendingWorktreesChangedEvent) => void,
  ) => () => void;
}

const ELECTRON_PENDING_WORKTREE_TRANSPORT: PendingWorktreeRouteTransport = {
  list: () => invoke("codex:pending-worktrees:list"),
  resolveThread: (clientThreadId) =>
    invoke("codex:pending-worktree:resolve-thread", clientThreadId),
  autoFix: (hostId, pendingWorktreeId, agentMode) =>
    invoke("codex:pending-worktree:auto-fix", hostId, pendingWorktreeId, agentMode),
  retry: (hostId, pendingWorktreeId) =>
    invoke("codex:pending-worktree:retry", hostId, pendingWorktreeId),
  workLocally: (hostId, pendingWorktreeId) =>
    invoke("codex:pending-worktree:work-locally", hostId, pendingWorktreeId),
  continue: (hostId, pendingWorktreeId) =>
    invoke("codex:pending-worktree:continue", hostId, pendingWorktreeId),
  cancel: (hostId, pendingWorktreeId) =>
    invoke("codex:pending-worktree:cancel", hostId, pendingWorktreeId),
  discardForkSidePanelTransfer: (pendingWorktreeId) =>
    invoke("codex:pending-worktree:discard-fork-side-panel-transfer", pendingWorktreeId),
  rename: (hostId, pendingWorktreeId, label) =>
    invoke("codex:pending-worktree:rename", hostId, pendingWorktreeId, label),
  setPinned: (hostId, pendingWorktreeId, isPinned) =>
    invoke("codex:pending-worktree:set-pinned", hostId, pendingWorktreeId, isPinned),
  clearAttention: (hostId, pendingWorktreeId) =>
    invoke("codex:pending-worktree:clear-attention", hostId, pendingWorktreeId),
  subscribe: subscribeCodexPendingWorktreesChanged,
};

interface PendingWorktreeRouteSnapshot {
  status: "loading" | "ready" | "missing" | "error";
  entry: CodexPendingWorktreeEntry | null;
  resolution: CodexPendingWorktreeThreadResolution | null;
  errorMessage: string | null;
}

const INITIAL_SNAPSHOT: PendingWorktreeRouteSnapshot = {
  status: "loading",
  entry: null,
  resolution: null,
  errorMessage: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Worktree setup could not be loaded.";
}

function findPendingWorktreeEntry(
  entries: readonly CodexPendingWorktreeEntry[],
  clientThreadId: string,
): CodexPendingWorktreeEntry | null {
  return entries.find((entry) =>
    entry.launchMode !== "create-stable-worktree"
    && entry.clientThreadId === clientThreadId
  ) ?? null;
}

function PendingWorktreeRouteHeader({
  entry,
  onRename,
  onTogglePinned,
  portalTarget,
}: {
  entry: CodexPendingWorktreeEntry;
  onRename: () => void;
  onTogglePinned: () => void;
  portalTarget?: HTMLElement | null;
}) {
  const header = (
    <div className="flex h-toolbar min-w-0 items-center gap-1 px-1">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-token-foreground">
        {entry.label || "Setting up worktree"}
      </h1>
      <button
        type="button"
        aria-label="Rename task"
        className="flex size-7 shrink-0 cursor-interaction items-center justify-center rounded-md text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:outline-none"
        onClick={onRename}
      >
        <TextActionPencilSmallIcon className="icon-xs" />
      </button>
      <button
        type="button"
        aria-label={entry.isPinned ? "Unpin task" : "Pin task"}
        className="flex size-7 shrink-0 cursor-interaction items-center justify-center rounded-md text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:outline-none"
        onClick={onTogglePinned}
      >
        {entry.isPinned
          ? <CodexSessionPinFilledIcon className="icon-xs" />
          : <CodexSessionPinIcon className="icon-xs" />}
      </button>
    </div>
  );
  if (portalTarget) return createPortal(header, portalTarget);
  return <div className="shrink-0 border-b border-token-border px-4">{header}</div>;
}

export interface PendingWorktreeRouteViewProps {
  entry: CodexPendingWorktreeEntry;
  resolution: CodexPendingWorktreeThreadResolution | null;
  busyAction?: PendingWorktreeRouteAction | null;
  actionError?: string | null;
  headerPortalTarget?: HTMLElement | null;
  onCancel: () => void;
  onContinue: () => void;
  onAutoFix: () => void;
  onEditEnvironment: () => void;
  onRename: (label: string) => void;
  onRetry: () => void;
  onTogglePinned: () => void;
  onWorkLocally: () => void;
}

export function PendingWorktreeRouteView({
  entry,
  resolution,
  busyAction = null,
  actionError = null,
  headerPortalTarget = null,
  onCancel,
  onContinue,
  onAutoFix,
  onEditEnvironment,
  onRename,
  onRetry,
  onTogglePinned,
  onWorkLocally,
}: PendingWorktreeRouteViewProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const activities = resolvePendingWorktreeActivities(entry, resolution);
  const availableActions = resolvePendingWorktreeRouteActions(entry, resolution);
  const actionButtons = availableActions.canCancel
    || availableActions.canAutoFix
    || availableActions.canContinue
    || availableActions.canEditEnvironment
    || availableActions.canRetry
    || availableActions.canWorkLocally
    ? (
        <>
          {availableActions.canWorkLocally ? (
            <NodexButton
              variant="secondary"
              size="sm"
              disabled={busyAction !== null}
              onClick={onWorkLocally}
            >
              {busyAction === "work-locally" ? "Starting locally…" : "Work locally"}
            </NodexButton>
          ) : null}
          {availableActions.canCancel ? (
            <NodexButton
              variant="secondary"
              size="sm"
              disabled={busyAction !== null}
              onClick={onCancel}
            >
              {busyAction === "cancel" ? "Canceling…" : "Cancel"}
            </NodexButton>
          ) : null}
          {availableActions.canEditEnvironment ? (
            <NodexButton
              variant="secondary"
              size="sm"
              disabled={busyAction !== null}
              onClick={onEditEnvironment}
            >
              Edit environment
            </NodexButton>
          ) : null}
          {availableActions.canAutoFix ? (
            <NodexButton
              variant="secondary"
              size="sm"
              disabled={busyAction !== null}
              onClick={onAutoFix}
            >
              {busyAction === "auto-fix" ? (
                <>
                  <SpinnerIcon className="icon-xs" />
                  Starting…
                </>
              ) : "Auto-fix"}
            </NodexButton>
          ) : null}
          {availableActions.canRetry ? (
            <NodexButton
              variant="secondary"
              size="sm"
              disabled={busyAction !== null}
              onClick={onRetry}
            >
              {busyAction === "retry" ? "Retrying…" : "Retry"}
            </NodexButton>
          ) : null}
          {availableActions.canContinue ? (
            <NodexButton
              variant="primary"
              size="sm"
              disabled={busyAction !== null}
              onClick={onContinue}
            >
              {busyAction === "continue" ? "Continuing…" : "Continue anyway"}
            </NodexButton>
          ) : null}
        </>
      )
    : null;

  return (
    <div
      data-testid="pending-worktree-route-shell"
      data-pending-worktree-phase={entry.phase}
      className="flex h-full min-h-0 flex-col bg-token-main-surface-primary"
    >
      <PendingWorktreeRouteHeader
        entry={entry}
        portalTarget={headerPortalTarget}
        onRename={() => setRenameOpen(true)}
        onTogglePinned={onTogglePinned}
      />
      <div className="scrollbar-token min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pt-16 pb-32">
          <div className="flex flex-col items-end gap-2">
            <div
              data-user-message-bubble="true"
              className={THREAD_VISUAL_TOKENS.userBubble}
            >
              <UserMessageText text={entry.prompt} />
            </div>
          </div>
          <WorktreeInitActivityList activities={activities} actions={actionButtons} />
          {actionError ? (
            <div role="alert" className="text-sm text-token-error-foreground">
              {actionError}
            </div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 px-5 pb-4">
        <div className="mx-auto max-w-3xl rounded-2xl border border-token-border bg-token-main-surface-primary px-4 py-3 text-size-chat text-token-input-placeholder-foreground opacity-80">
          Waiting for worktree setup…
        </div>
      </div>
      <RenameChatDialog
        open={renameOpen}
        initialValue={entry.label}
        busy={false}
        requireNonEmpty
        onOpenChange={setRenameOpen}
        onSave={(label) => {
          onRename(label);
          setRenameOpen(false);
        }}
      />
    </div>
  );
}

function PendingWorktreeRouteStatusSurface({
  error,
  onClose,
  onRetry,
}: {
  error: string | null;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const loading = error === null && onRetry === undefined;
  const missing = error === null && onRetry !== undefined;
  return (
    <div
      data-testid="pending-worktree-route-shell"
      className="flex h-full min-h-0 items-center justify-center bg-token-main-surface-primary px-6"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        {loading ? <SpinnerIcon className="icon-sm text-token-description-foreground" /> : null}
        <div className="text-sm font-medium text-token-foreground">
          {loading
            ? "Loading worktree setup…"
            : missing
              ? "Worktree setup is no longer available"
              : "Worktree setup could not be loaded"}
        </div>
        {error ? (
          <div role="alert" className="text-sm text-token-description-foreground">
            {error}
          </div>
        ) : null}
        {!loading ? (
          <div className="flex gap-2">
            <NodexButton variant="secondary" size="sm" onClick={onClose}>
              Back
            </NodexButton>
            {error && onRetry ? (
              <NodexButton variant="primary" size="sm" onClick={onRetry}>
                Retry
              </NodexButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface PendingWorktreeRouteProps {
  clientThreadId: string;
  agentMode?: CodexAgentMode;
  headerPortalTarget?: HTMLElement | null;
  transport?: PendingWorktreeRouteTransport;
  onClose: () => void;
  onOpenThread: (threadId: string) => Promise<boolean | void>;
  onOpenPendingWorktree?: (clientThreadId: string) => void;
  onCancelToSource?: (entry: CodexPendingWorktreeEntry) => void | Promise<void>;
  onEditEnvironment?: (entry: CodexPendingWorktreeEntry) => void;
}

export function PendingWorktreeRoute({
  clientThreadId,
  agentMode = "auto",
  headerPortalTarget = null,
  transport = ELECTRON_PENDING_WORKTREE_TRANSPORT,
  onClose,
  onOpenThread,
  onOpenPendingWorktree,
  onCancelToSource,
  onEditEnvironment,
}: PendingWorktreeRouteProps) {
  const [snapshot, setSnapshot] = useState<PendingWorktreeRouteSnapshot>(INITIAL_SNAPSHOT);
  const [busyAction, setBusyAction] = useState<PendingWorktreeRouteAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [workLocallyHidden, setWorkLocallyHidden] = useState(false);
  const loadSequenceRef = useRef(0);
  const openingThreadIdRef = useRef<string | null>(null);

  const load = useCallback(async (
    entriesOverride?: readonly CodexPendingWorktreeEntry[],
  ) => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    try {
      const [entries, resolution] = await Promise.all([
        entriesOverride ?? transport.list(),
        transport.resolveThread(clientThreadId),
      ]);
      if (loadSequenceRef.current !== sequence) return;
      const entry = findPendingWorktreeEntry(entries, clientThreadId);
      setSnapshot({
        status: entry || resolution ? "ready" : "missing",
        entry,
        resolution,
        errorMessage: null,
      });
    } catch (error) {
      if (loadSequenceRef.current !== sequence) return;
      setSnapshot({
        status: "error",
        entry: null,
        resolution: null,
        errorMessage: errorMessage(error),
      });
    }
  }, [clientThreadId, transport]);

  useEffect(() => {
    setSnapshot(INITIAL_SNAPSHOT);
    setActionError(null);
    setBusyAction(null);
    setWorkLocallyHidden(false);
    openingThreadIdRef.current = null;
    void load();
    return transport.subscribe((entries) => {
      void load(entries);
    });
  }, [clientThreadId, load, transport]);

  const clearAttentionOnRouteEntry = useEffectEvent(() => {
    const entry = snapshot.entry;
    if (!entry) return;
    void transport.clearAttention(entry.hostId, entry.id).catch(() => undefined);
  });

  const pendingWorktreeId = snapshot.entry?.id ?? null;
  useEffect(() => {
    if (pendingWorktreeId === null) return;
    clearAttentionOnRouteEntry();
  }, [pendingWorktreeId]);

  const openResolvedThread = useCallback((threadId: string) => {
    if (openingThreadIdRef.current === threadId) return;
    openingThreadIdRef.current = threadId;

    void onOpenThread(threadId)
      .then((opened) => {
        if (opened === false) {
          throw new Error("The created task could not be opened.");
        }
        onClose();
      })
      .catch((error) => {
        openingThreadIdRef.current = null;
        setActionError(errorMessage(error));
      });
  }, [onClose, onOpenThread]);

  useEffect(() => {
    if (snapshot.resolution?.state !== "succeeded") return;
    openResolvedThread(snapshot.resolution.threadId);
  }, [openResolvedThread, snapshot.resolution]);

  const runAction = useCallback(async (action: PendingWorktreeRouteAction) => {
    const entry = snapshot.entry;
    const pendingWorktreeId = entry?.id;
    const hostId = entry?.hostId;
    if (!entry || !pendingWorktreeId || !hostId || busyAction !== null) return;
    setActionError(null);
    if (action === "work-locally") setWorkLocallyHidden(true);
    setBusyAction(action);
    try {
      if (action === "cancel") {
        await transport.cancel(hostId, pendingWorktreeId);
        await transport.discardForkSidePanelTransfer(pendingWorktreeId);
        await onCancelToSource?.(entry);
        onClose();
        return;
      }
      if (action === "work-locally") {
        await transport.workLocally(hostId, pendingWorktreeId);
        await load();
        return;
      }
      if (action === "auto-fix") {
        const result = await transport.autoFix(hostId, pendingWorktreeId, agentMode);
        if (!result.clientThreadId) {
          throw new Error("The worktree repair task has no client thread id.");
        }
        onOpenPendingWorktree?.(result.clientThreadId);
        return;
      }
      if (action === "continue") {
        await transport.continue(hostId, pendingWorktreeId);
      } else {
        await transport.retry(hostId, pendingWorktreeId);
      }
      await load();
    } catch (error) {
      if (action === "work-locally") setWorkLocallyHidden(false);
      const message = errorMessage(error);
      if (action === "auto-fix") {
        toast.danger("Error starting task", { description: message });
      }
      setActionError(message);
    } finally {
      setBusyAction(null);
    }
  }, [agentMode, busyAction, load, onCancelToSource, onClose, onOpenPendingWorktree, snapshot.entry, transport]);

  const runMetadataAction = useCallback(async (
    action: "rename" | "pin",
    label?: string,
  ) => {
    const entry = snapshot.entry;
    if (!entry) return;
    setActionError(null);
    try {
      if (action === "rename") {
        if (!label?.trim()) return;
        await transport.rename(entry.hostId, entry.id, label.trim());
      } else {
        await transport.setPinned(entry.hostId, entry.id, !entry.isPinned);
      }
      await load();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }, [load, snapshot.entry, transport]);

  if (workLocallyHidden && actionError === null) return null;
  if (snapshot.status === "loading") {
    return <PendingWorktreeRouteStatusSurface error={null} onClose={onClose} />;
  }
  if (snapshot.status === "error") {
    return (
      <PendingWorktreeRouteStatusSurface
        error={snapshot.errorMessage}
        onClose={onClose}
        onRetry={() => {
          setSnapshot(INITIAL_SNAPSHOT);
          void load();
        }}
      />
    );
  }
  if (!snapshot.entry) {
    if (snapshot.resolution?.state === "succeeded") {
      const resolvedThreadId = snapshot.resolution.threadId;
      if (actionError) {
        return (
          <PendingWorktreeRouteStatusSurface
            error={actionError}
            onClose={onClose}
            onRetry={() => {
              setActionError(null);
              openingThreadIdRef.current = null;
              openResolvedThread(resolvedThreadId);
            }}
          />
        );
      }
      return <PendingWorktreeRouteStatusSurface error={null} onClose={onClose} />;
    }
    if (actionError) {
      return <PendingWorktreeRouteStatusSurface error={actionError} onClose={onClose} />;
    }
    if (snapshot.resolution?.state === "waiting") {
      return <PendingWorktreeRouteStatusSurface error={null} onClose={onClose} />;
    }
    if (snapshot.resolution?.state === "failed") {
      return (
        <PendingWorktreeRouteStatusSurface
          error={snapshot.resolution.errorMessage ?? "The local task could not be started."}
          onClose={onClose}
        />
      );
    }
    return (
      <PendingWorktreeRouteStatusSurface
        error={null}
        onClose={onClose}
        onRetry={() => {
          setSnapshot(INITIAL_SNAPSHOT);
          void load();
        }}
      />
    );
  }

  return (
    <PendingWorktreeRouteView
      entry={snapshot.entry}
      resolution={snapshot.resolution}
      busyAction={busyAction}
      actionError={actionError}
      headerPortalTarget={headerPortalTarget}
      onCancel={() => void runAction("cancel")}
      onContinue={() => void runAction("continue")}
      onAutoFix={() => void runAction("auto-fix")}
      onEditEnvironment={() => {
        if (snapshot.entry) onEditEnvironment?.(snapshot.entry);
      }}
      onRename={(label) => void runMetadataAction("rename", label)}
      onRetry={() => void runAction("retry")}
      onTogglePinned={() => void runMetadataAction("pin")}
      onWorkLocally={() => void runAction("work-locally")}
    />
  );
}
