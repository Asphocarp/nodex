import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CodexDesktopMessageFromView,
  RemoteHostedPipHiddenThreadIdsRequestedMessage,
  RemoteHostedPipStreamStateChangedMessage,
} from "../../../../shared/remote-hosted-pip";
import type {
  ThreadStageActions,
  ThreadSummaryPanelComputerUsePipState,
} from "../thread-stage-types";

interface RemoteHostedPipSummaryControl {
  onToggleSummaryComputerUsePip: NonNullable<ThreadStageActions["onToggleSummaryComputerUsePip"]>;
  summaryComputerUsePip: ThreadSummaryPanelComputerUsePipState | null;
}

type ActiveConversationMap = ReadonlyMap<string, boolean>;

function isRemoteHostedPipStreamStateChangedMessage(
  value: unknown,
): value is RemoteHostedPipStreamStateChangedMessage {
  if (typeof value !== "object" || value === null) return false;

  const message = value as Partial<RemoteHostedPipStreamStateChangedMessage>;
  return message.type === "remote-hosted-pip-stream-state-changed"
    && typeof message.conversationId === "string"
    && typeof message.isActive === "boolean"
    && typeof message.isAnyActive === "boolean";
}

function isRemoteHostedPipHiddenThreadIdsRequestedMessage(
  value: unknown,
): value is RemoteHostedPipHiddenThreadIdsRequestedMessage {
  if (typeof value !== "object" || value === null) return false;

  const message = value as Partial<RemoteHostedPipHiddenThreadIdsRequestedMessage>;
  return message.type === "remote-hosted-pip-hidden-thread-ids-requested"
    && Array.isArray(message.hiddenThreadIds)
    && message.hiddenThreadIds.every((threadId) => typeof threadId === "string");
}

function publishRemoteHostedPipMessageFromView(message: CodexDesktopMessageFromView): void {
  void window.electronBridge?.sendMessageFromView?.(message).catch(() => undefined);
}

export function useRemoteHostedPipSummaryControl(
  activeThreadId: string | null,
): RemoteHostedPipSummaryControl {
  const [hiddenThreadIds, setHiddenThreadIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [activeByConversationId, setActiveByConversationId] = useState<ActiveConversationMap>(() => new Map());

  useEffect(() => {
    publishRemoteHostedPipMessageFromView({
      type: "remote-hosted-pip-active-thread-changed",
      conversationId: activeThreadId,
    });

    return () => {
      publishRemoteHostedPipMessageFromView({
        type: "remote-hosted-pip-active-thread-changed",
        conversationId: null,
      });
    };
  }, [activeThreadId]);

  useEffect(() => {
    const unsubscribeStreamState = window.api?.on("remote-hosted-pip-stream-state-changed", (payload) => {
      if (!isRemoteHostedPipStreamStateChangedMessage(payload)) return;

      setActiveByConversationId((current) => {
        const next = new Map(current);
        if (payload.isActive) {
          next.set(payload.conversationId, true);
          return next;
        }

        next.delete(payload.conversationId);
        return next;
      });
    });

    const unsubscribeHiddenThreadIds = window.api?.on("remote-hosted-pip-hidden-thread-ids-requested", (payload) => {
      if (!isRemoteHostedPipHiddenThreadIdsRequestedMessage(payload)) return;
      setHiddenThreadIds(new Set(payload.hiddenThreadIds));
    });

    return () => {
      unsubscribeStreamState?.();
      unsubscribeHiddenThreadIds?.();
    };
  }, []);

  const summaryComputerUsePip = useMemo<ThreadSummaryPanelComputerUsePipState | null>(() => {
    if (!activeThreadId) return null;
    if (activeByConversationId.get(activeThreadId) !== true) return null;

    return { visible: !hiddenThreadIds.has(activeThreadId) };
  }, [activeByConversationId, activeThreadId, hiddenThreadIds]);

  const onToggleSummaryComputerUsePip = useCallback((nextVisible: boolean) => {
    if (!activeThreadId) return;
    const nextHiddenThreadIds = new Set(hiddenThreadIds);
    if (nextVisible) {
      nextHiddenThreadIds.delete(activeThreadId);
    } else {
      nextHiddenThreadIds.add(activeThreadId);
    }
    setHiddenThreadIds(nextHiddenThreadIds);
    publishRemoteHostedPipMessageFromView({
      type: "remote-hosted-pip-hidden-thread-ids-changed",
      hiddenThreadIds: [...nextHiddenThreadIds].sort(),
    });
  }, [activeThreadId, hiddenThreadIds]);

  return {
    onToggleSummaryComputerUsePip,
    summaryComputerUsePip,
  };
}
