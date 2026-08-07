import { expect, test } from "vitest";
import type {
  CoreEventEnvelope,
  CoreEventReplayRequired,
  CoreStreamCheckpoint,
} from "./types";
import { superviseCoreEventStream } from "./core-event-stream-supervisor";
import { createCoreLocalCommitFixture } from "./testing/local-commit-fixture";
import {
  CoreEventCompatibilityError,
  CoreHttpError,
} from "./uds-http";

function deferred<Value = void>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve: (value: Value) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<Value>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type DeferredValue<Value> = ReturnType<typeof deferred<Value>>;

function envelope(sequence: number): CoreEventEnvelope {
  return {
    transport_version: 4,
    packet: createCoreLocalCommitFixture({
      commitSeq: sequence,
      storeEpoch: "epoch:test",
      committedAt: "2026-07-22T00:00:00.000Z",
      payload: {
        module: "project_workspace",
        event: {
          kind: "workspace_changed",
          project_ids: [],
          session_ids: [],
          thread_ids: [],
          session_summary_scopes: [],
          session_detail_ids: [],
        },
      },
      canonicalHash: "0".repeat(64),
    }),
  };
}

const checkpoint = (sequence: number): CoreStreamCheckpoint => ({
  store_epoch: "epoch:test",
  generation: "generation:test",
  scanned_through_seq: sequence,
  oldest_available_seq: 0,
  resync_token: null,
});

test("reconnects from the last delivered sequence after a stream ends", async () => {
  const afterValues: number[] = [];
  const streams: Array<{
    readonly done: DeferredValue<void>;
    readonly onEvent: (event: CoreEventEnvelope) => void;
    readonly onCheckpoint: (checkpoint: CoreStreamCheckpoint) => void;
  }> = [];
  const supervisor = superviseCoreEventStream({
    initialAfter: 2,
    retryDelayMs: 0,
    open: async (after, onEvent, onCheckpoint) => {
      afterValues.push(after);
      const done = deferred();
      streams.push({ done, onEvent, onCheckpoint });
      return { done: done.promise, close: done.resolve };
    },
    onEvent: () => undefined,
    onResyncRequired: () => undefined,
  });

  await expect.poll(() => streams.length).toBe(1);
  streams[0]!.onEvent(envelope(7));
  streams[0]!.onCheckpoint(checkpoint(7));
  streams[0]!.done.resolve(undefined);
  await expect.poll(() => streams.length).toBe(2);
  expect(afterValues).toEqual([2, 7]);
  supervisor.close();
  await supervisor.done;
});

test("replays from the old cursor when ordered delivery fails", async () => {
  const afterValues: number[] = [];
  const streams: Array<{
    readonly done: DeferredValue<void>;
    readonly onEvent: (event: CoreEventEnvelope) => void;
    readonly onCheckpoint: (checkpoint: CoreStreamCheckpoint) => void;
  }> = [];
  let deliveries = 0;
  const supervisor = superviseCoreEventStream({
    initialAfter: 0,
    retryDelayMs: 0,
    open: async (after, onEvent, onCheckpoint) => {
      afterValues.push(after);
      const done = deferred();
      streams.push({ done, onEvent, onCheckpoint });
      return { done: done.promise, close: done.resolve };
    },
    onEvent: async () => {
      deliveries += 1;
      if (deliveries === 1) throw new Error("router rejected delivery");
    },
    onResyncRequired: () => undefined,
  });

  await expect.poll(() => streams.length).toBe(1);
  streams[0]!.onEvent(envelope(1));
  await expect.poll(() => streams.length).toBe(2);
  expect(afterValues).toEqual([0, 0]);
  streams[1]!.onEvent(envelope(1));
  streams[1]!.onCheckpoint(checkpoint(1));
  streams[1]!.done.resolve(undefined);
  await expect.poll(() => streams.length).toBe(3);
  expect(afterValues).toEqual([0, 0, 1]);
  supervisor.close();
  await supervisor.done;
});

test("heals a resync boundary and immediately resumes from its event head", async () => {
  const afterValues: number[] = [];
  const boundaries: CoreEventReplayRequired[] = [];
  const streams: Array<{
    readonly done: DeferredValue<void>;
    readonly onResync: (event: CoreEventReplayRequired) => void;
  }> = [];
  const supervisor = superviseCoreEventStream({
    initialAfter: 4,
    retryDelayMs: 0,
    open: async (after, _onEvent, _onCheckpoint, onResync) => {
      afterValues.push(after);
      const done = deferred();
      streams.push({ done, onResync });
      return { done: done.promise, close: done.resolve };
    },
    onEvent: () => undefined,
    onResyncRequired: (boundary) => boundaries.push(boundary),
  });

  await expect.poll(() => streams.length).toBe(1);
  streams[0]!.onResync({
    requested_after: 4,
    oldest_available: 10,
    commit_head: 14,
    generation: "generation:test",
    resync_token: "resync:test",
  });
  await expect.poll(() => streams.length).toBe(2);
  expect(afterValues).toEqual([4, 14]);
  expect(boundaries).toHaveLength(1);
  supervisor.close();
  await supervisor.done;
});

test("retries from the same cursor when opening the stream fails", async () => {
  const afterValues: number[] = [];
  const interruptions: unknown[] = [];
  const connected = deferred();
  let attempts = 0;
  const supervisor = superviseCoreEventStream({
    initialAfter: 9,
    retryDelayMs: 0,
    open: async (after) => {
      attempts += 1;
      afterValues.push(after);
      if (attempts === 1) throw new Error("temporary connection failure");
      return { done: connected.promise, close: connected.resolve };
    },
    onEvent: () => undefined,
    onResyncRequired: () => undefined,
    onInterrupted: (error) => interruptions.push(error),
  });

  await expect.poll(() => attempts).toBe(2);
  expect(afterValues).toEqual([9, 9]);
  expect(interruptions).toHaveLength(1);
  expect(interruptions[0]).toEqual(new Error("temporary connection failure"));
  supervisor.close();
  await supervisor.done;
});

test("fails permanently without retrying a compatibility mismatch", async () => {
  const mismatch = new CoreEventCompatibilityError(
    "Core event Store epoch is invalid",
  );
  const interruptions: unknown[] = [];
  let attempts = 0;
  const supervisor = superviseCoreEventStream({
    initialAfter: 11,
    retryDelayMs: 0,
    open: async () => {
      attempts += 1;
      return {
        done: Promise.reject(mismatch),
        close: () => undefined,
      };
    },
    onEvent: () => undefined,
    onResyncRequired: () => undefined,
    onInterrupted: (error) => interruptions.push(error),
  });

  await expect(supervisor.done).rejects.toBe(mismatch);
  expect(attempts).toBe(1);
  expect(interruptions).toEqual([mismatch]);
});

test("exposes initial readiness and a fresh connection barrier while reconnecting", async () => {
  const firstDone = deferred();
  const secondDone = deferred();
  const secondOpen = deferred<{
    readonly done: Promise<void>;
    close(): void;
  }>();
  const states: string[] = [];
  let attempts = 0;
  const supervisor = superviseCoreEventStream({
    initialAfter: 0,
    retryDelayMs: 0,
    open: async () => {
      attempts += 1;
      if (attempts === 1) {
        return { done: firstDone.promise, close: () => firstDone.resolve(undefined) };
      }
      return await secondOpen.promise;
    },
    onEvent: () => undefined,
    onResyncRequired: () => undefined,
    onConnectionStateChanged: (state) => states.push(state),
  });

  await expect(supervisor.ready).resolves.toBeUndefined();
  expect(states).toEqual(["connected"]);

  firstDone.resolve(undefined);
  await expect.poll(() => attempts).toBe(2);
  expect(states).toEqual(["connected", "disconnected"]);

  let reconnected = false;
  const connection = supervisor.waitUntilConnected().then(() => {
    reconnected = true;
  });
  await Promise.resolve();
  expect(reconnected).toBe(false);

  secondOpen.resolve({
    done: secondDone.promise,
    close: () => secondDone.resolve(undefined),
  });
  await connection;
  expect(states).toEqual(["connected", "disconnected", "connected"]);

  supervisor.close();
  await supervisor.done;
});

test("bounds retryable initial opening attempts", async () => {
  const openingError = new Error("Document stream failed to open");
  let attempts = 0;
  const supervisor = superviseCoreEventStream({
    initialAfter: 0,
    retryDelayMs: 0,
    maxInitialOpenAttempts: 2,
    open: async () => {
      attempts += 1;
      throw openingError;
    },
    onEvent: () => undefined,
    onResyncRequired: () => undefined,
  });
  const done = supervisor.done.catch((error: unknown) => error);

  await expect(supervisor.ready).rejects.toBe(openingError);
  await expect(done).resolves.toBe(openingError);
  expect(attempts).toBe(2);
});

test("aborts an opening request when the logical subscription closes", async () => {
  let aborted = false;
  const supervisor = superviseCoreEventStream({
    initialAfter: 0,
    open: async (_after, _onEvent, _onCheckpoint, _onResyncRequired, signal) =>
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        }, { once: true });
        void resolve;
      }),
    onEvent: () => undefined,
    onResyncRequired: () => undefined,
  });
  void supervisor.ready.catch(() => undefined);

  supervisor.close();

  await expect(supervisor.done).resolves.toBeUndefined();
  expect(aborted).toBe(true);
});

test("terminates after a non-retryable reopening response", async () => {
  const firstDone = deferred();
  const terminal = new CoreHttpError(404, "Document is no longer available");
  let attempts = 0;
  const supervisor = superviseCoreEventStream({
    initialAfter: 0,
    retryDelayMs: 0,
    shouldRetry: (error) =>
      !(error instanceof CoreHttpError) || error.status >= 500,
    open: async () => {
      attempts += 1;
      if (attempts === 1) {
        return { done: firstDone.promise, close: () => firstDone.resolve(undefined) };
      }
      throw terminal;
    },
    onEvent: () => undefined,
    onResyncRequired: () => undefined,
  });

  await supervisor.ready;
  firstDone.resolve(undefined);

  await expect(supervisor.done).rejects.toBe(terminal);
  expect(attempts).toBe(2);
});
