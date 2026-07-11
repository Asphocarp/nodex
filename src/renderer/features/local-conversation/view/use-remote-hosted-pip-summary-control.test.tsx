import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act } from "@testing-library/react";
import { useEffect } from "react";
import { render, settleAsyncRender } from "../../../test/dom";
import type { CodexDesktopMessageFromView } from "../../../../shared/remote-hosted-pip";
import { useRemoteHostedPipSummaryControl } from "./use-remote-hosted-pip-summary-control";

type IpcListener = (payload: unknown) => void;
type ListenerMap = Record<string, IpcListener[]>;
type RemoteHostedPipSummaryControlValue = ReturnType<typeof useRemoteHostedPipSummaryControl>;

function Probe({
  threadId,
  onValue,
}: {
  threadId: string | null;
  onValue: (value: RemoteHostedPipSummaryControlValue) => void;
}) {
  const value = useRemoteHostedPipSummaryControl(threadId);
  useEffect(() => {
    onValue(value);
  }, [onValue, value]);

  return null;
}

async function emitIpcEvent(
  listenersByChannel: ListenerMap,
  channel: string,
  payload: unknown,
): Promise<void> {
  await act(async () => {
    for (const listener of listenersByChannel[channel] ?? []) {
      listener(payload);
    }
    await settleAsyncRender();
  });
}

describe("useRemoteHostedPipSummaryControl", () => {
  const originalApi = window.api;
  const originalElectronBridge = window.electronBridge;
  let listenersByChannel: ListenerMap;
  let sentMessages: CodexDesktopMessageFromView[];

  beforeEach(() => {
    listenersByChannel = {};
    sentMessages = [];

    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        ...(originalApi ?? {}),
        invoke: async () => null,
        on: (channel: string, callback: IpcListener) => {
          listenersByChannel[channel] = [...(listenersByChannel[channel] ?? []), callback];
          return () => {
            listenersByChannel[channel] = (listenersByChannel[channel] ?? [])
              .filter((listener) => listener !== callback);
          };
        },
      },
      writable: true,
    });

    Object.defineProperty(window, "electronBridge", {
      configurable: true,
      value: {
        ...(originalElectronBridge ?? {}),
        sendMessageFromView: async (message: CodexDesktopMessageFromView) => {
          sentMessages.push(message);
        },
      },
      writable: true,
    });
  });

  afterEach(() => {
    if (typeof originalApi === "undefined") {
      Reflect.deleteProperty(window, "api");
    } else {
      Object.defineProperty(window, "api", {
        configurable: true,
        value: originalApi,
        writable: true,
      });
    }

    if (typeof originalElectronBridge === "undefined") {
      Reflect.deleteProperty(window, "electronBridge");
      return;
    }

    Object.defineProperty(window, "electronBridge", {
      configurable: true,
      value: originalElectronBridge,
      writable: true,
    });
  });

  test("derives the summary PiP row from stream state and visibility events", async () => {
    let latest: RemoteHostedPipSummaryControlValue | undefined;
    const readLatest = () => {
      if (!latest) {
        throw new Error("Expected remote-hosted PiP summary control value.");
      }

      return latest;
    };
    const view = render(
      <Probe
        threadId="thread-1"
        onValue={(value) => {
          latest = value;
        }}
      />,
    );

    await settleAsyncRender();

    expect(sentMessages[0]?.type).toBe("remote-hosted-pip-active-thread-changed");
    if (sentMessages[0]?.type === "remote-hosted-pip-active-thread-changed") {
      expect(sentMessages[0].conversationId).toBe("thread-1");
    }
    expect(readLatest().summaryComputerUsePip).toBe(null);

    await emitIpcEvent(listenersByChannel, "remote-hosted-pip-stream-state-changed", {
      type: "remote-hosted-pip-stream-state-changed",
      conversationId: "other-thread",
      isActive: true,
      isAnyActive: true,
    });

    expect(readLatest().summaryComputerUsePip).toBe(null);

    await emitIpcEvent(listenersByChannel, "remote-hosted-pip-stream-state-changed", {
      type: "remote-hosted-pip-stream-state-changed",
      conversationId: "thread-1",
      isActive: true,
      isAnyActive: true,
    });

    expect(readLatest().summaryComputerUsePip?.visible).toBe(true);

    await emitIpcEvent(listenersByChannel, "remote-hosted-pip-visibility-requested", {
      type: "remote-hosted-pip-visibility-requested",
      isVisible: true,
    });

    expect(readLatest().summaryComputerUsePip?.visible).toBe(true);

    await act(async () => {
      readLatest().onToggleSummaryComputerUsePip(false);
      await settleAsyncRender();
    });

    expect(readLatest().summaryComputerUsePip?.visible).toBe(false);
    const lastMessage = sentMessages[sentMessages.length - 1];
    expect(lastMessage?.type).toBe("remote-hosted-pip-visibility-changed");
    if (lastMessage?.type === "remote-hosted-pip-visibility-changed") {
      expect(lastMessage.isVisible).toBe(false);
    }

    await emitIpcEvent(listenersByChannel, "remote-hosted-pip-stream-state-changed", {
      type: "remote-hosted-pip-stream-state-changed",
      conversationId: "thread-1",
      isActive: false,
      isAnyActive: false,
    });

    expect(readLatest().summaryComputerUsePip).toBe(null);

    await act(async () => {
      view.unmount();
      await settleAsyncRender();
    });
    const cleanupMessage = sentMessages[sentMessages.length - 1];
    expect(cleanupMessage?.type).toBe("remote-hosted-pip-active-thread-changed");
    if (cleanupMessage?.type === "remote-hosted-pip-active-thread-changed") {
      expect(cleanupMessage.conversationId).toBe(null);
    }
  });
});
