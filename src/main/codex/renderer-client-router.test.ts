import { describe, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import type {
  CodexRendererClientRequestMessage,
  CodexRendererClientResponseMessage,
} from "../../shared/types";
import {
  COMPLETE_HISTORY_RENDERER_CLIENT_REQUEST_TIMEOUT_MS,
  RendererClientRouter,
} from "./renderer-client-router";

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
    if (this.destroyed) {
      throw new Error("webContents destroyed");
    }
    this.sent.push({ channel, args });
  }

  destroy(): void {
    this.destroyed = true;
    this.emit("destroyed");
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

function readFirstRequest(target: FakeWebContents): CodexRendererClientRequestMessage {
  const sent = target.sent[0];
  if (!sent) throw new Error("Missing sent renderer request");

  return sent.args[0] as CodexRendererClientRequestMessage;
}

async function readRejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("RendererClientRouter", () => {
  test("assigns a stable client id per webContents", () => {
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
    });
    const webContents = new FakeWebContents(10);

    const first = router.register(webContents);
    const second = router.ensureClient(webContents);

    expect(first.clientId).toBe("client-1");
    expect(second.clientId).toBe("client-1");
    expect(router.getClientCount()).toBe(1);
    expect(router.getClientIdForWebContentsId(10)).toBe("client-1");
    expect(router.getWebContentsIdForClientId("client-1")).toBe(10);

    first.dispose();

    expect(router.getClientCount()).toBe(0);
    expect(router.getClientIdForWebContentsId(10)).toBe(null);
  });

  test("sends a targeted request and resolves from the target webContents response", async () => {
    const timers = createManualTimers();
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
      requestIdFactory: createIdFactory("request"),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const target = new FakeWebContents(11);
    const registration = router.register(target);

    const resultPromise = router.sendRequest<string>(
      registration.clientId,
      "codex.thread.getVisibleState",
      { threadId: "thread-1" },
    );

    const request = readFirstRequest(target);
    expect(target.sent[0]?.channel).toBe("codex:renderer-client:request");
    expect(request.requestId).toBe("request-1");
    expect(request.method).toBe("codex.thread.getVisibleState");
    expect(router.getPendingRequestCount()).toBe(1);

    const accepted = router.handleResponse(target, {
      type: "success",
      requestId: request.requestId,
      result: "ok",
    });

    expect(accepted).toBe(true);
    expect(await resultPromise).toBe("ok");
    expect(router.getPendingRequestCount()).toBe(0);
    expect(timers.size).toBe(0);
  });

  test("keeps a request pending when a non-target webContents responds", async () => {
    const timers = createManualTimers();
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
      requestIdFactory: createIdFactory("request"),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      logger: {
        debug: () => undefined,
        warn: () => undefined,
      },
    });
    const target = new FakeWebContents(12);
    const other = new FakeWebContents(13);
    const registration = router.register(target);
    router.register(other);

    const resultPromise = router.sendRequest<string>(
      registration.clientId,
      "codex.thread.getVisibleState",
      { threadId: "thread-1" },
    );
    const request = readFirstRequest(target);
    const response: CodexRendererClientResponseMessage = {
      type: "success",
      requestId: request.requestId,
      result: "wrong",
    };

    expect(router.handleResponse(other, response)).toBe(false);
    expect(router.getPendingRequestCount()).toBe(1);

    expect(
      router.handleResponse(target, {
        type: "success",
        requestId: request.requestId,
        result: "right",
      }),
    ).toBe(true);
    expect(await resultPromise).toBe("right");
  });

  test("rejects pending requests when the target webContents is destroyed", async () => {
    const timers = createManualTimers();
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
      requestIdFactory: createIdFactory("request"),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const target = new FakeWebContents(14);
    const registration = router.register(target);

    const resultPromise = router.sendRequest(
      registration.clientId,
      "codex.thread.getVisibleState",
      { threadId: "thread-1" },
    );

    target.destroy();

    const message = await readRejectionMessage(resultPromise);
    expect(message.includes("was destroyed")).toBe(true);
    expect(router.getClientCount()).toBe(0);
    expect(router.getPendingRequestCount()).toBe(0);
    expect(timers.size).toBe(0);
  });

  test("notifies listeners when a renderer client is disposed", () => {
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
    });
    const target = new FakeWebContents(141);
    const registration = router.register(target);
    const disposedEvents: Array<{ clientId: string; webContentsId: number; reason: string }> = [];
    router.addClientDisposedListener((event) => {
      disposedEvents.push(event);
    });

    target.destroy();

    expect(disposedEvents.length).toBe(1);
    expect(disposedEvents[0]?.clientId).toBe(registration.clientId);
    expect(disposedEvents[0]?.webContentsId).toBe(141);
    expect(disposedEvents[0]?.reason).toBe("destroyed");
  });

  test("rejects pending requests on timeout", async () => {
    const timers = createManualTimers();
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
      requestIdFactory: createIdFactory("request"),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const target = new FakeWebContents(15);
    const registration = router.register(target);

    const resultPromise = router.sendRequest(
      registration.clientId,
      "codex.thread.getVisibleState",
      { threadId: "thread-1" },
      { timeoutMs: 25 },
    );

    expect(timers.fireNext()).toBe(true);

    const message = await readRejectionMessage(resultPromise);
    expect(message.includes("timed out after 25ms")).toBe(true);
    expect(router.getPendingRequestCount()).toBe(0);
  });

  test("queries renderer thread role before owner-routed work", async () => {
    const timers = createManualTimers();
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
      requestIdFactory: createIdFactory("request"),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const target = new FakeWebContents(151);
    const registration = router.register(target);

    const rolePromise = router.queryThreadRole(registration.clientId, "thread-1");
    const request = readFirstRequest(target);

    expect(request.method).toBe("thread-role");
    expect((request.params as { conversationId?: string }).conversationId).toBe("thread-1");

    expect(
      router.handleResponse(target, {
        type: "success",
        requestId: request.requestId,
        result: "owner",
      }),
    ).toBe(true);
    expect(await rolePromise).toBe("owner");
  });

  test("requires target renderer to still be owner", async () => {
    const timers = createManualTimers();
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
      requestIdFactory: createIdFactory("request"),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const target = new FakeWebContents(152);
    const registration = router.register(target);

    const ownerPromise = router.requireThreadOwner(registration.clientId, "thread-1");
    const request = readFirstRequest(target);
    expect(
      router.handleResponse(target, {
        type: "success",
        requestId: request.requestId,
        result: "follower",
      }),
    ).toBe(true);

    const message = await readRejectionMessage(ownerPromise);
    expect(message.includes("no-client-found")).toBe(true);
    expect(message.includes("not owner")).toBe(true);
  });

  test("uses Codex Electron complete-history owner request timeout", () => {
    expect(COMPLETE_HISTORY_RENDERER_CLIENT_REQUEST_TIMEOUT_MS).toBe(300_000);
  });

  test("broadcast can skip the source client", () => {
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
    });
    const source = new FakeWebContents(16);
    const follower = new FakeWebContents(17);
    const sourceRegistration = router.register(source);
    router.register(follower);

    const sentCount = router.broadcast("codex:test", [{ value: 1 }], {
      sourceClientId: sourceRegistration.clientId,
      includeSource: false,
    });

    expect(sentCount).toBe(1);
    expect(source.sent.length).toBe(0);
    expect(follower.sent.length).toBe(1);
    expect(follower.sent[0]?.channel).toBe("codex:test");
  });

  test("delivers only to an explicit target client set and reports unavailable clients", () => {
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
    });
    const first = new FakeWebContents(18);
    const second = new FakeWebContents(19);
    const firstRegistration = router.register(first);
    const secondRegistration = router.register(second);

    const result = router.sendToClients(
      [firstRegistration.clientId, secondRegistration.clientId, "client-missing"],
      "codex:targeted",
      [{ value: 1 }],
    );

    expect(result.sentClientIds).toEqual(["client-1", "client-2"]);
    expect(result.unavailableClientIds).toEqual(["client-missing"]);
    expect(result.failedClientIds).toEqual([]);
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(1);
  });

  test("treats an empty target set as a no-op", () => {
    const router = new RendererClientRouter({
      clientIdFactory: createIdFactory("client"),
    });
    const target = new FakeWebContents(20);
    router.register(target);

    expect(router.sendToClients([], "codex:targeted", [])).toEqual({
      sentClientIds: [],
      unavailableClientIds: [],
      failedClientIds: [],
    });
    expect(target.sent).toHaveLength(0);
  });
});
