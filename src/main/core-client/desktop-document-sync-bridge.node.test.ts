import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { DocumentSyncClientTarget } from "../document-sync-transport";
import {
  DesktopDocumentSessionRuntime,
  desktopDocumentSessionRuntimeLive,
} from "./desktop-document-sync-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { documentLiveRuntimeTestDouble } from "./document-live-runtime.test-support";
import { createFakeCoreHandshake, FakeCoreClient } from "./testing/fake-core-client";
import type { CoreClientPort, CoreDocumentEventSubscription } from "./types";

const subscribeRequest = {
  documentId: "document:one",
  clientSessionId: "renderer:one",
} as const;

class FakeTarget implements DocumentSyncClientTarget {
  readonly sent: Array<{ readonly channel: string; readonly payload: unknown }> = [];
  readonly #destroyedListeners: Array<() => void> = [];
  #destroyed = false;

  constructor(readonly id: number) {}

  get destroyedListenerCount(): number {
    return this.#destroyedListeners.length;
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  send(channel: string, ...args: unknown[]): void {
    this.sent.push({ channel, payload: args[0] });
  }

  once(event: "destroyed", listener: () => void): void {
    if (event === "destroyed") this.#destroyedListeners.push(listener);
  }

  removeListener(event: "destroyed", listener: () => void): void {
    if (event !== "destroyed") return;
    const index = this.#destroyedListeners.indexOf(listener);
    if (index >= 0) this.#destroyedListeners.splice(index, 1);
  }
}

class ControlledOpeningDocumentStreamClient extends FakeCoreClient {
  openings = 0;
  readonly openingStarted: Promise<void>;
  #resolveOpeningStarted: () => void = () => undefined;

  constructor() {
    super();
    this.openingStarted = new Promise<void>((resolve) => {
      this.#resolveOpeningStarted = resolve;
    });
  }

  override openDocumentEventStream(
    input: Parameters<CoreClientPort["openDocumentEventStream"]>[0],
  ): Promise<CoreDocumentEventSubscription> {
    this.openings += 1;
    this.#resolveOpeningStarted();
    return new Promise<CoreDocumentEventSubscription>((_resolve, reject) => {
      const signal = input.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }
}

class TrackingDocumentStreamClient extends FakeCoreClient {
  activeSubscriptions = 0;

  override async openDocumentEventStream(
    ...args: Parameters<FakeCoreClient["openDocumentEventStream"]>
  ): Promise<CoreDocumentEventSubscription> {
    const subscription = await super.openDocumentEventStream(...args);
    this.activeSubscriptions += 1;
    let closed = false;
    return {
      ...subscription,
      close: () => {
        if (closed) return;
        closed = true;
        this.activeSubscriptions -= 1;
        subscription.close();
      },
    };
  }
}

const runtimeFor = (client: FakeCoreClient): RustDataAuthorityRuntime => {
  Object.assign(client, {
    handshake: createFakeCoreHandshake({
      connectionBinding: "binding:test",
      libraryId: "library:test",
      profileId: "profile:test",
      storeEpoch: "epoch:test",
    }),
  });
  const desktopClient = client as unknown as RustDataAuthorityRuntime["rootClient"];
  return {
    backend: "rust",
    identity: {
      libraryId: "library:test",
      profileId: "profile:test",
      storeEpoch: "epoch:test",
    },
    launch: {} as RustDataAuthorityRuntime["launch"],
    rootClient: desktopClient,
    clientForProject: () => desktopClient,
  };
};

const acquireSession = Effect.fn("DesktopDocumentSessionRuntime.test.acquire")(function* (
  client: FakeCoreClient,
) {
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(
    desktopDocumentSessionRuntimeLive({
      authority: runtimeFor(client),
      documentLive: documentLiveRuntimeTestDouble,
    }),
    scope,
  );
  return {
    scope,
    session: Context.get(context, DesktopDocumentSessionRuntime),
  };
});

it.effect("releases an active subscription and its target listener with the owning Scope", () =>
  Effect.gen(function* () {
    const client = new TrackingDocumentStreamClient();
    const { scope, session } = yield* acquireSession(client);
    const target = new FakeTarget(1);

    const subscribed = yield* session.subscribe(
      { kind: "project", projectId: "project:one" },
      target,
      subscribeRequest,
    );
    assert.deepStrictEqual(subscribed, { ok: true, value: { subscribed: true } });
    assert.strictEqual(target.destroyedListenerCount, 1);
    assert.strictEqual(client.activeSubscriptions, 1);

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(target.destroyedListenerCount, 0);
    assert.strictEqual(client.activeSubscriptions, 0);

    const closedAdmission = yield* session.subscribe(
      { kind: "project", projectId: "project:one" },
      target,
      subscribeRequest,
    );
    assert.isFalse(closedAdmission.ok);
  }),
);

it.effect("settles a pending reservation and its waiter when the owning Scope closes", () =>
  Effect.gen(function* () {
    const client = new ControlledOpeningDocumentStreamClient();
    const { scope, session } = yield* acquireSession(client);
    const target = new FakeTarget(2);
    const access = { kind: "project", projectId: "project:one" } as const;

    const opening = yield* Effect.forkChild(session.subscribe(access, target, subscribeRequest));
    yield* Effect.promise(() => client.openingStarted);
    const waiting = yield* Effect.forkChild(session.subscribe(access, target, subscribeRequest));
    yield* Effect.yieldNow;
    assert.strictEqual(client.openings, 1);
    assert.strictEqual(target.destroyedListenerCount, 1);

    yield* Scope.close(scope, Exit.void);
    const [openingResult, waitingResult] = yield* Effect.all([
      Fiber.join(opening),
      Fiber.join(waiting),
    ]);
    assert.isFalse(openingResult.ok);
    assert.isFalse(waitingResult.ok);
    assert.strictEqual(target.destroyedListenerCount, 0);
  }),
);
