import { describe, expect, test } from "bun:test";
import { LocalConversationStreamState } from "./local-conversation-stream-state";

function createManualTimers() {
  let nextTimerId = 1;
  const timers = new Map<number, () => void>();

  return {
    setTimeout: (callback: () => void) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    clearTimeout: (timer: unknown) => {
      timers.delete(timer as number);
    },
    fireNext: () => {
      const next = timers.entries().next();
      if (next.done) return false;

      const [timerId, callback] = next.value;
      timers.delete(timerId);
      callback();
      return true;
    },
    get size() {
      return timers.size;
    },
  };
}

async function readRejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("LocalConversationStreamState", () => {
  test("applies patches only for the active follower owner and drops mismatches from bundle 40608-40613", () => {
    const streamState = new LocalConversationStreamState();

    expect(streamState.evaluatePatch({
      conversationId: "thread-1",
      baseRevision: 0,
      sourceClientId: "owner-a",
    }).type).toBe("drop");

    streamState.acceptSnapshot({
      conversationId: "thread-1",
      revision: 3,
      sourceClientId: "owner-a",
    });

    expect(streamState.evaluatePatch({
      conversationId: "thread-1",
      baseRevision: 3,
      sourceClientId: "owner-a",
    }).type).toBe("apply");
    expect(streamState.evaluatePatch({
      conversationId: "thread-1",
      baseRevision: 3,
      sourceClientId: "owner-b",
    }).type).toBe("drop");
    expect(streamState.evaluatePatch({
      conversationId: "thread-1",
      baseRevision: 2,
      sourceClientId: "owner-a",
    }).type).toBe("drop");
  });

  test("tracks streaming conversation ids separately from source-null baseline role", () => {
    const streamState = new LocalConversationStreamState();

    streamState.acceptSnapshot({
      conversationId: "thread-1",
      revision: 1,
      sourceClientId: null,
    });
    streamState.setStreaming("thread-1", true);
    streamState.setStreaming("thread-2", true);
    streamState.setStreaming("thread-1", false);

    expect(streamState.getStreamingConversationIds().join(",")).toBe("thread-2");
    expect(streamState.getRole("thread-1")?.role).toBe("sourceNull");
    expect(streamState.getRevision("thread-1")).toBe(1);
  });

  test("applies source-null patches only after a source-null baseline snapshot", () => {
    const streamState = new LocalConversationStreamState();

    streamState.acceptSnapshot({
      conversationId: "thread-1",
      revision: 1,
      sourceClientId: null,
    });

    expect(streamState.evaluatePatch({
      conversationId: "thread-1",
      baseRevision: 1,
      sourceClientId: null,
    }).type).toBe("apply");
    expect(streamState.evaluatePatch({
      conversationId: "thread-1",
      baseRevision: 1,
      sourceClientId: "owner-a",
    }).type).toBe("drop");
    expect(streamState.evaluatePatch({
      conversationId: "thread-1",
      baseRevision: 0,
      sourceClientId: null,
    }).type).toBe("drop");

    streamState.acceptPatch({
      conversationId: "thread-1",
      revision: 2,
      sourceClientId: null,
    });

    expect(streamState.getRole("thread-1")?.role).toBe("sourceNull");
    expect(streamState.getRevision("thread-1")).toBe(2);
  });

  test("source-null updates do not mark a real owner unavailable", () => {
    const streamState = new LocalConversationStreamState();

    streamState.acceptSnapshot({
      conversationId: "thread-source-null",
      revision: 1,
      sourceClientId: null,
    });
    streamState.acceptSnapshot({
      conversationId: "thread-follower",
      revision: 1,
      sourceClientId: "owner-a",
    });

    const affectedConversationIds = streamState.markOwnerUnavailable("owner-a");

    expect(affectedConversationIds.join(",")).toBe("thread-follower");
    expect(streamState.getRole("thread-source-null")?.role).toBe("sourceNull");
    expect(streamState.getRole("thread-follower")).toBe(null);
  });

  test("resolves revision waiters when matching owner reaches the target revision", async () => {
    const timers = createManualTimers();
    const streamState = new LocalConversationStreamState({
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    let resolved = false;

    streamState.acceptSnapshot({
      conversationId: "thread-1",
      revision: 1,
      sourceClientId: "owner-a",
    });
    const waiter = streamState.waitForRevision({
      conversationId: "thread-1",
      ownerClientId: "owner-a",
      revision: 2,
      timeoutMs: 50,
    }).then(() => {
      resolved = true;
    });

    streamState.acceptPatch({
      conversationId: "thread-1",
      revision: 2,
      sourceClientId: "owner-a",
    });

    await waiter;
    expect(resolved).toBeTrue();
    expect(timers.size).toBe(0);
  });

  test("rejects revision waiters when the owner changes", async () => {
    const timers = createManualTimers();
    const streamState = new LocalConversationStreamState({
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    streamState.acceptSnapshot({
      conversationId: "thread-1",
      revision: 1,
      sourceClientId: "owner-a",
    });
    const waiter = streamState.waitForRevision({
      conversationId: "thread-1",
      ownerClientId: "owner-a",
      revision: 3,
      timeoutMs: 50,
    });

    streamState.acceptSnapshot({
      conversationId: "thread-1",
      revision: 2,
      sourceClientId: "owner-b",
    });

    const message = await readRejectionMessage(waiter);
    expect(message.includes("Stream owner changed")).toBeTrue();
    expect(timers.size).toBe(0);
  });

  test("rejects revision waiters when the owner becomes unavailable", async () => {
    const streamState = new LocalConversationStreamState();

    streamState.acceptSnapshot({
      conversationId: "thread-1",
      revision: 1,
      sourceClientId: "owner-a",
    });
    const waiter = streamState.waitForRevision({
      conversationId: "thread-1",
      ownerClientId: "owner-a",
      revision: 3,
      timeoutMs: 50,
    });

    const affectedConversationIds = streamState.markOwnerUnavailable("owner-a");
    const message = await readRejectionMessage(waiter);

    expect(affectedConversationIds.join(",")).toBe("thread-1");
    expect(message.includes("unavailable")).toBeTrue();
    expect(streamState.getRole("thread-1")).toBe(null);
  });

  test("rejects revision waiters on timeout", async () => {
    const timers = createManualTimers();
    const streamState = new LocalConversationStreamState({
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    streamState.acceptSnapshot({
      conversationId: "thread-1",
      revision: 1,
      sourceClientId: "owner-a",
    });
    const waiter = streamState.waitForRevision({
      conversationId: "thread-1",
      ownerClientId: "owner-a",
      revision: 2,
      timeoutMs: 25,
    });

    expect(timers.fireNext()).toBeTrue();

    const message = await readRejectionMessage(waiter);
    expect(message.includes("Timed out waiting")).toBeTrue();
  });
});
