import { describe, expect, it, vi } from "vitest";
import type { BlockRecordModule } from "../shared/core-modules/block-record-module";
import type { LocalCommitEnvelope } from "../shared/local-commit";
import {
  BLOCK_RECORD_APPLY_IPC_CHANNEL,
  BLOCK_RECORD_READ_IPC_CHANNEL,
  BLOCK_RECORD_SUBSCRIBE_IPC_CHANNEL,
  BLOCK_RECORD_UNSUBSCRIBE_IPC_CHANNEL,
  registerBlockRecordIpcHandler,
} from "./block-record-ipc";
import { LocalCommitDispatcher } from "./core-client/local-commit-dispatcher";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const envelope = (): LocalCommitEnvelope => ({
  cursor: { storeEpoch: "epoch-1", commitSeq: 1 },
  commitId: "commit-1",
  operationId: "operation-1",
  intentHash: "intent-hash",
  canonicalHash: "canonical-hash",
  committedAt: "2026-08-06T00:00:00.000Z",
  actorId: "actor",
  sessionId: "session",
  payloadCompleteness: "rich",
  audience: { kind: "library", projectIds: [] },
  effects: [],
});

describe("BlockRecord IPC", () => {
  it("routes typed reads and applies, and forwards dispatcher commits to subscribers", async () => {
    const handlers = new Map<string, Handler>();
    const dispatcher = new LocalCommitDispatcher();
    const read = vi.fn(async (input) => ({ input }));
    const apply = vi.fn(async (input) => ({ input }));
    const sent: LocalCommitEnvelope[] = [];
    const sender = { id: 7, once: vi.fn() };
    const event = { sender };
    registerBlockRecordIpcHandler({
      registerHandle: (channel, listener) => handlers.set(channel, listener),
      isTrustedEvent: () => true,
      module: { read, apply } as unknown as BlockRecordModule,
      dispatcher,
      getSenderId: () => sender.id,
      sendCommit: (_event, commit) => sent.push(commit),
      onSenderDestroyed: vi.fn(),
    });

    const readRequest = { kind: "window" } as const;
    expect(await handlers.get(BLOCK_RECORD_READ_IPC_CHANNEL)?.(event, readRequest))
      .toEqual({ input: readRequest });
    const applyRequest = { operation_id: "operation-1" } as never;
    expect(await handlers.get(BLOCK_RECORD_APPLY_IPC_CHANNEL)?.(event, applyRequest))
      .toEqual({ input: applyRequest });

    await handlers.get(BLOCK_RECORD_SUBSCRIBE_IPC_CHANNEL)?.(event);
    dispatcher.accept(envelope(), "apply");
    await dispatcher.waitForIdle();
    expect(sent).toEqual([envelope()]);
    await handlers.get(BLOCK_RECORD_UNSUBSCRIBE_IPC_CHANNEL)?.(event);
    dispatcher.accept({ ...envelope(), commitSeq: 2 } as never, "apply");
    await dispatcher.waitForIdle();
    expect(sent).toHaveLength(1);
    expect(read).toHaveBeenCalledWith(readRequest);
    expect(apply).toHaveBeenCalledWith(applyRequest);
  });

  it("rejects untrusted reads before reaching Core", async () => {
    const handlers = new Map<string, Handler>();
    const read = vi.fn();
    registerBlockRecordIpcHandler({
      registerHandle: (channel, listener) => handlers.set(channel, listener),
      isTrustedEvent: () => false,
      module: { read, apply: vi.fn() } as unknown as BlockRecordModule,
      dispatcher: new LocalCommitDispatcher(),
      getSenderId: () => 1,
      sendCommit: () => undefined,
      onSenderDestroyed: () => undefined,
    });

    await expect(
      handlers.get(BLOCK_RECORD_READ_IPC_CHANNEL)?.({ sender: { id: 1 } }, { kind: "window" }),
    ).rejects.toThrow("trusted application window");
    expect(read).not.toHaveBeenCalled();
  });
});
