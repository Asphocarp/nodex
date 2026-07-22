import { expect, test } from "vitest";
import type {
  CoreEventEnvelope,
  CoreEventReplayRequired,
} from "./types";
import { superviseCoreEventStream } from "./core-event-stream-supervisor";
import { CoreEventCompatibilityError } from "./uds-http";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function envelope(sequence: number): CoreEventEnvelope {
  return {
    transport_version: 3,
    event: {
      event_version: 2,
      sequence,
      store_epoch: "epoch:test",
      committed_at: "2026-07-22T00:00:00.000Z",
      projection_impact: { kind: "none" },
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
    },
  };
}

test("reconnects from the last delivered sequence after a stream ends", async () => {
  const afterValues: number[] = [];
  const streams: Array<{
    readonly done: ReturnType<typeof deferred>;
    readonly onEvent: (event: CoreEventEnvelope) => void;
  }> = [];
  const supervisor = superviseCoreEventStream({
    initialAfter: 2,
    retryDelayMs: 0,
    open: async (after, onEvent) => {
      afterValues.push(after);
      const done = deferred();
      streams.push({ done, onEvent });
      return { done: done.promise, close: done.resolve };
    },
    onEvent: () => undefined,
    onResyncRequired: () => undefined,
  });

  await expect.poll(() => streams.length).toBe(1);
  streams[0]!.onEvent(envelope(7));
  streams[0]!.done.resolve();
  await expect.poll(() => streams.length).toBe(2);
  expect(afterValues).toEqual([2, 7]);
  supervisor.close();
  await supervisor.done;
});

test("replays from the old cursor when ordered delivery fails", async () => {
  const afterValues: number[] = [];
  const streams: Array<{
    readonly done: ReturnType<typeof deferred>;
    readonly onEvent: (event: CoreEventEnvelope) => void;
  }> = [];
  let deliveries = 0;
  const supervisor = superviseCoreEventStream({
    initialAfter: 0,
    retryDelayMs: 0,
    open: async (after, onEvent) => {
      afterValues.push(after);
      const done = deferred();
      streams.push({ done, onEvent });
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
  streams[1]!.done.resolve();
  await expect.poll(() => streams.length).toBe(3);
  expect(afterValues).toEqual([0, 0, 1]);
  supervisor.close();
  await supervisor.done;
});

test("heals a resync boundary and immediately resumes from its event head", async () => {
  const afterValues: number[] = [];
  const boundaries: CoreEventReplayRequired[] = [];
  const streams: Array<{
    readonly done: ReturnType<typeof deferred>;
    readonly onResync: (event: CoreEventReplayRequired) => void;
  }> = [];
  const supervisor = superviseCoreEventStream({
    initialAfter: 4,
    retryDelayMs: 0,
    open: async (after, _onEvent, onResync) => {
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
    event_head: 14,
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
