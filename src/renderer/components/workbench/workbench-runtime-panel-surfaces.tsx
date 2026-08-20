import { useEffect, useState } from "react";
import { LazySourceViewer } from "@/components/ui/lazy-source-viewer";
import { NodexTooltip } from "@/components/ui/tooltip";
import { useConversation } from "@/features/local-conversation";
import { McpCapabilityViewFrame } from "@/features/local-conversation/view/shared/tools/mcp-capability-view-frame";
import { terminalSessionStore } from "@/lib/terminal-session-store";
import type { TerminalSessionSnapshot } from "../../../shared/types";
import { findProcessOutputCommandItem } from "@/lib/workbench-process-output-target";
import type { McpAppPanelTab, ProcessOutputPanelTab } from "@/lib/workbench-panel-tab-model";

export function McpAppSessionTab({ tab }: { tab: McpAppPanelTab }) {
  return (
    <div
      className="h-full min-h-0 bg-token-main-surface-primary"
      data-mcp-app-side-panel-tab={tab.id}
      data-mcp-capability-id={tab.app.capabilityId}
    >
      <McpCapabilityViewFrame capabilityId={tab.app.capabilityId} mode="side-panel" />
    </div>
  );
}

function useProcessOutputTerminalSnapshot(
  sessionId: string | null,
): TerminalSessionSnapshot | null {
  const [snapshot, setSnapshot] = useState<TerminalSessionSnapshot | null>(() =>
    sessionId ? terminalSessionStore.getSnapshot(sessionId) : null,
  );

  useEffect(() => {
    if (!sessionId) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    terminalSessionStore.ensureEventSubscriptions();
    setSnapshot(terminalSessionStore.getSnapshot(sessionId));
    void terminalSessionStore.fetchSnapshot(sessionId).then((nextSnapshot) => {
      if (!cancelled && nextSnapshot) {
        setSnapshot(nextSnapshot);
      }
    });

    const unsubscribe = terminalSessionStore.subscribe(sessionId, (event) => {
      if (cancelled) return;
      if (event.type === "init-log" || event.type === "attached") {
        setSnapshot(event.snapshot);
        return;
      }
      if (event.type === "exit") {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                exited: true,
                exitCode: event.exitCode,
              }
            : terminalSessionStore.getSnapshot(sessionId),
        );
        return;
      }
      setSnapshot(terminalSessionStore.getSnapshot(sessionId));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sessionId]);

  return snapshot;
}

export function ProcessOutputPanelTabView({ tab }: { tab: ProcessOutputPanelTab }) {
  const conversation = useConversation(tab.threadId);
  const terminalSnapshot = useProcessOutputTerminalSnapshot(tab.terminalSessionId);
  const item = findProcessOutputCommandItem(conversation, tab.itemId, tab.turnId);
  const command = item?.command ?? tab.command;
  const cwd = terminalSnapshot?.cwd ?? item?.cwd ?? tab.cwd;
  const output = terminalSnapshot ? terminalSnapshot.buffer : (item?.aggregatedOutput ?? "");
  const displayCommand = command.trim() || "Background terminal";
  const displayOutput = output.trimEnd();

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-token-main-surface-primary"
      data-process-output-panel-tab={tab.id}
      data-thread-id={tab.threadId}
      data-item-id={tab.itemId}
    >
      <div className="flex min-h-14 shrink-0 flex-col justify-center border-b border-token-border px-3 py-2">
        <NodexTooltip tooltipContent={displayCommand} side="top">
          <div className="truncate font-mono text-xs text-token-foreground">{displayCommand}</div>
        </NodexTooltip>
        {cwd ? (
          <NodexTooltip tooltipContent={cwd} side="top">
            <div className="mt-1 truncate text-xs text-token-description-foreground">{cwd}</div>
          </NodexTooltip>
        ) : null}
      </div>
      {displayOutput ? (
        <LazySourceViewer
          value={displayOutput}
          ariaLabel={`Process output for ${displayCommand}`}
          sourceIdentity={tab.terminalSessionId ?? `${tab.threadId}:${tab.itemId}`}
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-token-description-foreground">
          No output yet
        </div>
      )}
    </div>
  );
}
