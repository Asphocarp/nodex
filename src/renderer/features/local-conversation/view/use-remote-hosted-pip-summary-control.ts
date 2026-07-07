import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CodexDesktopMessageFromView,
  RemoteHostedPipStreamStateChangedMessage,
  RemoteHostedPipVisibilityRequestedMessage,
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

function isRemoteHostedPipVisibilityRequestedMessage(
  value: unknown,
): value is RemoteHostedPipVisibilityRequestedMessage {
  if (typeof value !== "object" || value === null) return false;

  const message = value as Partial<RemoteHostedPipVisibilityRequestedMessage>;
  return message.type === "remote-hosted-pip-visibility-requested"
    && typeof message.isVisible === "boolean";
}

function publishRemoteHostedPipMessageFromView(message: CodexDesktopMessageFromView): void {
  void window.electronBridge?.sendMessageFromView?.(message).catch(() => undefined);
}

export function useRemoteHostedPipSummaryControl(
  activeThreadId: string | null,
): RemoteHostedPipSummaryControl {
  const [visible, setVisible] = useState(true);
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

    const unsubscribeVisibility = window.api?.on("remote-hosted-pip-visibility-requested", (payload) => {
      if (!isRemoteHostedPipVisibilityRequestedMessage(payload)) return;
      setVisible(payload.isVisible);
    });

    return () => {
      unsubscribeStreamState?.();
      unsubscribeVisibility?.();
    };
  }, []);

  const summaryComputerUsePip = useMemo<ThreadSummaryPanelComputerUsePipState | null>(() => {
    if (!activeThreadId) return null;
    if (activeByConversationId.get(activeThreadId) !== true) return null;

    return { visible };
  }, [activeByConversationId, activeThreadId, visible]);

  const onToggleSummaryComputerUsePip = useCallback((nextVisible: boolean) => {
    setVisible(nextVisible);
    publishRemoteHostedPipMessageFromView({
      type: "remote-hosted-pip-visibility-changed",
      isVisible: nextVisible,
    });
  }, []);

  return {
    onToggleSummaryComputerUsePip,
    summaryComputerUsePip,
  };
}
