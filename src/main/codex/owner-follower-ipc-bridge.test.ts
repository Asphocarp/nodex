import { EventEmitter } from "node:events";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import type {
  CodexHostMessage,
  CodexThreadOwnerNotificationAckInput,
  CodexThreadOwnerStreamStatePublishInput,
  CodexThreadOwnerStreamStatePublishResult,
} from "../../shared/types";
import { live, RendererClientRuntime } from "../host-runtime/RendererClientRuntime";
import {
  broadcastCodexHostMessageToRendererClients,
  type CodexOwnerFollowerService,
  publishRendererThreadOwnerStreamState,
  runThreadFollowerActionThroughOwner,
} from "./owner-follower-ipc-bridge";

class FakeWebContents extends EventEmitter {
  readonly sent: Array<{ readonly channel: string; readonly args: readonly unknown[] }> = [];
  destroyed = false;

  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, ...args: readonly unknown[]): void {
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

  acknowledgeRendererFollowerSnapshotApplied(): boolean {
    return true;
  }

  requestRendererThreadStreamResync(): boolean {
    return true;
  }

  publishRendererThreadStreamStateChange(
    sourceClientId: string,
    input: CodexThreadOwnerStreamStatePublishInput,
  ): CodexThreadOwnerStreamStatePublishResult {
    const ownerClientId = this.ownerByThread.get(input.conversationId);
    if (!ownerClientId || ownerClientId !== sourceClientId) {
      return { accepted: false, reason: "not-owner", recovery: null };
    }
    this.hostMessages.push({
      type: "threadStreamStateChanged",
      hostId: "local",
      conversationId: input.conversationId,
      change: input.change,
      version: this.hostMessages.length + 1,
      sourceClientId,
      baseCheckpoint: input.baseCheckpoint,
      checkpoint: input.checkpoint,
    });
    return { accepted: true, checkpoint: input.checkpoint };
  }

  setOwner(threadId: string, clientId: string): void {
    this.ownerByThread.set(threadId, clientId);
  }
}

const checkpoint = (revision: number) => ({
  protocolVersion: 1 as const,
  ownerEpoch: 1,
  revision,
  canonicalHash: "a".repeat(64),
});

const idFactory = (prefix: string): (() => string) => {
  let next = 0;
  return () => `${prefix}:${++next}`;
};

const makeRuntime = Effect.fn("CodexOwnerFollowerTest.makeRuntime")(function* () {
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(
    live({
      clientIdFactory: idFactory("client"),
      requestIdFactory: idFactory("request"),
    }),
    scope,
  );
  return { runtime: Context.get(context, RendererClientRuntime), scope };
});

const readRendererRequest = (target: FakeWebContents, index: number) => {
  const sent = target.sent[index];
  if (!sent) throw new Error("Missing sent renderer request");
  return sent.args[0] as {
    readonly method: string;
    readonly params: unknown;
    readonly requestId: string;
  };
};

it.effect("publishes owner stream-state only to follower renderer clients", () =>
  Effect.gen(function* () {
    const { runtime, scope } = yield* makeRuntime();
    const service = new FakeOwnerFollowerService();
    const owner = new FakeWebContents(1);
    const follower = new FakeWebContents(2);
    const ownerRegistration = runtime.register(owner);
    runtime.register(follower);
    service.setOwner("thread-1", ownerRegistration.clientId);

    const accepted = publishRendererThreadOwnerStreamState(service, ownerRegistration.clientId, {
      conversationId: "thread-1",
      change: { type: "patches", baseRevision: 0, revision: 1, patches: [] },
      baseCheckpoint: checkpoint(0),
      checkpoint: checkpoint(1),
    });
    const rejected = publishRendererThreadOwnerStreamState(service, "client:stale", {
      conversationId: "thread-1",
      change: { type: "patches", baseRevision: 1, revision: 2, patches: [] },
      baseCheckpoint: checkpoint(1),
      checkpoint: checkpoint(2),
    });
    assert.isTrue(accepted.accepted);
    assert.deepInclude(rejected, { accepted: false, reason: "not-owner" });
    const hostMessage = service.hostMessages[0];
    if (!hostMessage) return yield* Effect.die("Missing host message");
    assert.strictEqual(
      broadcastCodexHostMessageToRendererClients(
        runtime,
        () => {
          throw new Error("Window fallback must not run with registered clients");
        },
        hostMessage,
      ),
      1,
    );
    assert.strictEqual(owner.sent.length, 0);
    assert.strictEqual(follower.sent.length, 1);
    assert.strictEqual(follower.sent[0]?.args[0], hostMessage);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("routes a follower action through current-owner proof and one request authority", () =>
  Effect.gen(function* () {
    const { runtime, scope } = yield* makeRuntime();
    const service = new FakeOwnerFollowerService();
    const owner = new FakeWebContents(11);
    const follower = new FakeWebContents(12);
    const ownerRegistration = runtime.register(owner);
    const followerRegistration = runtime.register(follower);
    service.setOwner("thread-1", ownerRegistration.clientId);
    const result = yield* Effect.forkChild(
      runThreadFollowerActionThroughOwner(service, runtime, followerRegistration.clientId, {
        conversationId: "thread-1",
        action: { type: "interruptTurn", threadId: "thread-1" },
      }),
    );
    yield* Effect.yieldNow;
    const roleRequest = readRendererRequest(owner, 0);
    assert.strictEqual(roleRequest.method, "thread-role");
    assert.isTrue(
      yield* runtime.handleResponse(owner, {
        type: "success",
        requestId: roleRequest.requestId,
        result: "owner",
      }),
    );
    yield* Effect.yieldNow;
    const actionRequest = readRendererRequest(owner, 1);
    assert.strictEqual(actionRequest.method, "thread-owner-action");
    assert.isTrue(
      yield* runtime.handleResponse(owner, {
        type: "success",
        requestId: actionRequest.requestId,
        result: { ok: true },
      }),
    );
    assert.deepEqual(yield* Fiber.join(result), { ok: true });
    assert.strictEqual(runtime.getPendingRequestCount(), 0);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("normalizes an unavailable complete-history owner", () =>
  Effect.gen(function* () {
    const { runtime, scope } = yield* makeRuntime();
    const service = new FakeOwnerFollowerService();
    const owner = new FakeWebContents(21);
    const follower = new FakeWebContents(22);
    const ownerRegistration = runtime.register(owner);
    const followerRegistration = runtime.register(follower);
    service.setOwner("thread-1", ownerRegistration.clientId);
    owner.destroy();
    yield* Effect.yieldNow;
    const error = yield* runThreadFollowerActionThroughOwner(
      service,
      runtime,
      followerRegistration.clientId,
      {
        conversationId: "thread-1",
        action: { type: "loadCompleteHistory", threadId: "thread-1" },
      },
    ).pipe(Effect.asVoid, Effect.flip);
    assert.match(error.message, /no-client-found/);
    assert.match(error.message, /thread-1/);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("normalizes a missing owner before sending follower work", () =>
  Effect.gen(function* () {
    const { runtime, scope } = yield* makeRuntime();
    const service = new FakeOwnerFollowerService();
    const follower = new FakeWebContents(32);
    const followerRegistration = runtime.register(follower);
    const error = yield* runThreadFollowerActionThroughOwner(
      service,
      runtime,
      followerRegistration.clientId,
      {
        conversationId: "thread-missing-owner",
        action: { type: "startTurn", threadId: "thread-missing-owner", prompt: "Continue" },
      },
    ).pipe(Effect.asVoid, Effect.flip);
    assert.match(error.message, /no-client-found/);
    assert.match(error.message, /thread-missing-owner/);
    assert.strictEqual(follower.sent.length, 0);
    yield* Scope.close(scope, Exit.void);
  }),
);
