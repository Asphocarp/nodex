import { expect, test, vi } from "vitest";

import type { LocalCommitEnvelope } from "../../shared/local-commit";
import {
  LocalCommitDispatcher,
  LocalCommitProtocolError,
} from "./local-commit-dispatcher";

const envelope = (
  sequence: number,
  completeness: "sparse" | "rich" = "rich",
): LocalCommitEnvelope => ({
  cursor: { storeEpoch: "epoch:test", commitSeq: sequence },
  commitId: `commit:${sequence}`,
  operationId: `operation:${sequence}`,
  intentHash: `intent:${sequence}`,
  canonicalHash: `canonical:${sequence}`,
  committedAt: "2026-08-06T00:00:00.000Z",
  actorId: "actor:test",
  sessionId: "session:test",
  payloadCompleteness: completeness,
  effects: [],
  audience: { kind: "library", projectIds: [] },
});

test("delivers N+1 and then N instead of dropping the older cursor", async () => {
  const received: number[] = [];
  const dispatcher = new LocalCommitDispatcher();
  dispatcher.subscribe((commit) => {
    received.push(commit.cursor.commitSeq);
  });

  expect(dispatcher.accept(envelope(2), "apply").kind).toBe("new");
  expect(dispatcher.accept(envelope(1), "tailer").kind).toBe("new");
  await dispatcher.waitForIdle();

  expect(received).toEqual([2, 1]);
  expect(dispatcher.tailerCursor).toEqual({
    storeEpoch: "epoch:test",
    commitSeq: 1,
  });
});

test("deduplicates the same cursor while allowing sparse payload enrichment", async () => {
  const received: Array<"sparse" | "rich"> = [];
  const dispatcher = new LocalCommitDispatcher();
  dispatcher.subscribe((commit) => {
    received.push(commit.payloadCompleteness);
  });

  expect(dispatcher.accept(envelope(1, "sparse"), "apply").kind).toBe("new");
  expect(dispatcher.accept(envelope(1, "sparse"), "tailer").kind).toBe("duplicate");
  expect(dispatcher.accept(envelope(1, "rich"), "resolve").kind).toBe("enriched");
  await dispatcher.waitForIdle();

  expect(received).toEqual(["sparse", "rich"]);
});

test("rejects a same-cursor canonical hash mismatch", () => {
  const dispatcher = new LocalCommitDispatcher();
  dispatcher.accept(envelope(1), "apply");
  const conflicting = { ...envelope(1), canonicalHash: "canonical:corrupt" };

  expect(() => dispatcher.accept(conflicting, "tailer"))
    .toThrow(LocalCommitProtocolError);
});

test("apply fast path does not advance the durable tailer cursor", () => {
  const dispatcher = new LocalCommitDispatcher({
    initialCursor: { storeEpoch: "epoch:test", commitSeq: 10 },
  });
  dispatcher.accept(envelope(11), "apply");
  expect(dispatcher.tailerCursor).toEqual({
    storeEpoch: "epoch:test",
    commitSeq: 10,
  });
  dispatcher.accept(envelope(11), "tailer");
  expect(dispatcher.tailerCursor).toEqual({
    storeEpoch: "epoch:test",
    commitSeq: 11,
  });
});

test("admission does not wait for a slow listener", async () => {
  const release = vi.fn<() => void>();
  let resolveListener: (() => void) | undefined;
  let shouldBlock = true;
  const dispatcher = new LocalCommitDispatcher();
  dispatcher.subscribe(async () => {
    if (shouldBlock) {
      shouldBlock = false;
      await new Promise<void>((resolve) => {
        resolveListener = resolve;
      });
    }
    release();
  });

  expect(dispatcher.accept(envelope(1), "apply").kind).toBe("new");
  expect(dispatcher.accept(envelope(2), "apply").kind).toBe("new");
  await Promise.resolve();
  expect(resolveListener).toBeDefined();
  expect(release).not.toHaveBeenCalled();

  resolveListener?.();
  await dispatcher.waitForIdle();
  expect(release).toHaveBeenCalledTimes(2);
});

test("rejects a commit from another Store epoch until reset", () => {
  const dispatcher = new LocalCommitDispatcher({
    initialCursor: { storeEpoch: "epoch:test", commitSeq: 4 },
  });
  const foreign = {
    ...envelope(1),
    cursor: { storeEpoch: "epoch:new", commitSeq: 1 },
  };
  expect(dispatcher.accept(foreign, "tailer").kind).toBe("epoch-mismatch");
  dispatcher.resetForStoreEpoch(foreign.cursor);
  expect(dispatcher.accept(foreign, "tailer").kind).toBe("new");
});
