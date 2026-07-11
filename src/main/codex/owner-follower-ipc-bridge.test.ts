import { describe, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import type {
  CodexHostMessage,
  CodexThreadOwnerNotificationAckInput,
  CodexThreadOwnerStreamStatePublishInput,
} from "../../shared/types";
import {
  broadcastCodexHostMessageToRendererClients,
  type CodexOwnerFollowerService,
  publishRendererThreadOwnerStreamState,
  runThreadFollowerActionThroughOwner,
} from "./owner-follower-ipc-bridge";
import { RendererClientRouter } from "./renderer-client-router";

class FakeWebContents extends EventEmitter {
  readonly sent: Array<{ channel: string; args: unknown[] }> = [];
  destroyed = false;

  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, ...args: unknown[]): void {
    if (this.destroyed) throw new Error("webContents destroyed");

    this.sent.push({ channel, args });
  }

  destroy(): void {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

class FakeOwnerFollowerService implements CodexOwnerFollowerService {
  readonly hostMessages: CodexHostMessage[] = [];
  readonly disposedClientIds: string[] = [];
  private readonly ownerByThread = new Map<string, string>();

  ackRendererThreadOwnerNotification(
    sourceClientId: string,
    input: CodexThreadOwnerNotificationAckInput,
  ): boolean {
    return this.ownerByThread.get(input.conversationId) === sourceClientId;
  }

  getRendererConversationOwner(threadId: string): string | null {
    return this.ownerByThread.get(threadId) ?? null;
  }

  handleRendererClientDisposed(clientId: string): void {
    this.disposedClientIds.push(clientId);
  }

  publishRendererThreadStreamStateChange(
    sourceClientId: string,
    input: CodexThreadOwnerStreamStatePublishInput,
  ): boolean {
    const ownerClientId = this.ownerByThread.get(input.conversationId);
    if (ownerClientId && ownerClientId !== sourceClientId) return false;

    if (!ownerClientId) {
      this.ownerByThread.set(input.conversationId, sourceClientId);
    }

    this.hostMessages.push({
      type: "threadStreamStateChanged",
      hostId: "local",
      conversationId: input.conversationId,
      change: input.change,
      version: this.hostMessages.length + 1,
      sourceClientId,
    });
    return true;
  }

  setOwner(threadId: string, clientId: string): void {
    this.ownerByThread.set(threadId, clientId);
  }
}

function createIdFactory(prefix: string): () => string {
  let nextId = 1;
  return () => {
    const id = `${prefix}-${nextId}`;
    nextId += 1;
    return id;
  };
}

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
    get size() {
      return timers.size;
    },
  };
}

function readRendererRequest(target: FakeWebContents, index: number): {
  method: string;
  params: unknown;
  requestId: string;
} {
  const sent = target.sent[index];
  if (!sent) throw new Error("Missing sent renderer request");

  return sent.args[0] as { method: string; params: unknown; requestId: string };
}

async function readRejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("owner/follower IPC bridge", () => {
  test("publishes owner stream-state to follower clients while skipping the source owner from bundle 40592-40621 and 65040-66095", () => {
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
    });
    const service = new FakeOwnerFollowerService();
    const owner = new FakeWebContents(1);
    const follower = new FakeWebContents(2);
    const ownerRegistration = router.register(owner);
    router.register(follower);
    service.setOwner("thread-1", ownerRegistration.clientId);

    const accepted = publishRendererThreadOwnerStreamState(service, ownerRegistration.clientId, {
      conversationId: "thread-1",
      change: {
        type: "patches",
        baseRevision: 0,
        revision: 1,
        patches: [],
      },
    });
    const rejected = publishRendererThreadOwnerStreamState(service, "client-stale", {
      conversationId: "thread-1",
      change: {
        type: "patches",
        baseRevision: 1,
        revision: 2,
        patches: [],
      },
    });

    expect(accepted).toBe(true);
    expect(rejected).toBe(false);
    expect(String(service.hostMessages.length)).toBe("1");

    const hostMessage = service.hostMessages[0];
    if (!hostMessage) throw new Error("Missing host message");
    const fallbackCount = broadcastCodexHostMessageToRendererClients(
      router,
      () => {
        throw new Error("window broadcast fallback should not run with a renderer router");
      },
      hostMessage,
    );

    expect(fallbackCount).toBe(1);
    expect(String(owner.sent.length)).toBe("0");
    expect(String(follower.sent.length)).toBe("1");
    expect(follower.sent[0]?.channel).toBe("codex:host-message");
    expect(follower.sent[0]?.args[0]).toBe(hostMessage);
  });

  test("routes follower actions through the current owner after owner role proof from bundle 65040-66095", async () => {
    const timers = createManualTimers();
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
      requestIdFactory: createIdFactory("request"),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const service = new FakeOwnerFollowerService();
    const owner = new FakeWebContents(11);
    const follower = new FakeWebContents(12);
    const ownerRegistration = router.register(owner);
    const followerRegistration = router.register(follower);
    service.setOwner("thread-1", ownerRegistration.clientId);

    const resultPromise = runThreadFollowerActionThroughOwner(
      service,
      router,
      followerRegistration.clientId,
      {
        conversationId: "thread-1",
        action: {
          type: "interruptTurn",
          threadId: "thread-1",
        },
      },
    );

    const roleRequest = readRendererRequest(owner, 0);
    expect(roleRequest.method).toBe("thread-role");
    expect((roleRequest.params as { conversationId?: string }).conversationId).toBe("thread-1");
    expect(String(follower.sent.length)).toBe("0");

    expect(router.handleResponse(owner, {
      type: "success",
      requestId: roleRequest.requestId,
      result: "owner",
    })).toBe(true);
    await flushPromises();

    const actionRequest = readRendererRequest(owner, 1);
    expect(actionRequest.method).toBe("thread-owner-action");
    expect((actionRequest.params as { type?: string }).type).toBe("interruptTurn");
    expect((actionRequest.params as { threadId?: string }).threadId).toBe("thread-1");

    expect(router.handleResponse(owner, {
      type: "success",
      requestId: actionRequest.requestId,
      result: { ok: true },
    })).toBe(true);

    const result = await resultPromise as { ok?: boolean };
    expect(result.ok).toBe(true);
    expect(router.getPendingRequestCount()).toBe(0);
    expect(timers.size).toBe(0);
  });

  test("normalizes unavailable complete-history owner errors from bundle 65040-66095", async () => {
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
      requestIdFactory: createIdFactory("request"),
    });
    const service = new FakeOwnerFollowerService();
    const owner = new FakeWebContents(21);
    const follower = new FakeWebContents(22);
    const ownerRegistration = router.register(owner);
    const followerRegistration = router.register(follower);
    service.setOwner("thread-1", ownerRegistration.clientId);
    owner.destroy();

    const message = await readRejectionMessage(runThreadFollowerActionThroughOwner(
      service,
      router,
      followerRegistration.clientId,
      {
        conversationId: "thread-1",
        action: {
          type: "loadCompleteHistory",
          threadId: "thread-1",
        },
      },
    ));

    expect(message.includes("no-client-found")).toBe(true);
    expect(message.includes("thread-1")).toBe(true);
  });

  test("normalizes missing owners for every follower action from bundle 40602-40933 and 47201-47228", async () => {
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
      requestIdFactory: createIdFactory("request"),
    });
    const service = new FakeOwnerFollowerService();
    const follower = new FakeWebContents(32);
    const followerRegistration = router.register(follower);

    const message = await readRejectionMessage(runThreadFollowerActionThroughOwner(
      service,
      router,
      followerRegistration.clientId,
      {
        conversationId: "thread-missing-owner",
        action: {
          type: "startTurn",
          threadId: "thread-missing-owner",
          prompt: "Continue",
        },
      },
    ));

    expect(message.includes("no-client-found")).toBe(true);
    expect(message.includes("thread-missing-owner")).toBe(true);
    expect(String(follower.sent.length)).toBe("0");
  });
});
