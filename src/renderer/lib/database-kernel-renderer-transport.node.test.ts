import { describe, expect, test, vi } from "vitest";
import {
  createElectronRendererTransport,
  initializeElectronRendererLocalCommitIngress,
} from "./electron-renderer-transport";

describe("Database event renderer IPC", () => {
  test("subscribes and filters the scoped projection contract", async () => {
    const recipient = {
      listener: null as ((...args: unknown[]) => void) | null,
    };
    const invocations: Array<{ channel: string; args: unknown[] }> = [];
    const bridge = {
      invoke: async (channel: string, ...args: unknown[]) => {
        invocations.push({ channel, args });
      },
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        if (channel === "recipient-delivery:message") recipient.listener = listener;
        return () => {
          recipient.listener = null;
        };
      },
    };
    initializeElectronRendererLocalCommitIngress(bridge as never);
    const transport = createElectronRendererTransport(bridge as never);
    const scope = {
      kind: "project" as const,
      libraryId: "library-1",
      projectId: "project-1",
    };
    const messages: unknown[] = [];
    const release = transport.subscribeProjectionStream(
      scope,
      (message) => messages.push(message),
    );
    await Promise.resolve();
    const message = {
      version: 2 as const,
      kind: "checkpoint" as const,
      scope,
      stream: { storeEpoch: "epoch-1", commitSeq: 7 },
    };
    recipient.listener?.({
      version: 1,
      deliveryId: "a".repeat(64),
      scope,
      payload: { lane: "projection", message },
    });
    await vi.waitFor(() => expect(messages).toEqual([message]));

    release();
    await Promise.resolve();
    expect(invocations).toEqual([
      { channel: "projection-stream:subscribe", args: [scope] },
      {
        channel: "recipient-delivery:admit",
        args: [{
          version: 1,
          deliveryId: "a".repeat(64),
          outcome: "ack",
        }],
      },
      { channel: "projection-stream:unsubscribe", args: [scope] },
    ]);
  });
});
