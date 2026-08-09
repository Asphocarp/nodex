import { describe, expect, test, vi, type Mock } from "vitest";

import type { ProjectionScope } from "../../shared/projection-stream";
import type {
  CoreEventEnvelope,
  CoreProjectionEventSubscription,
  ProjectionLiveBarrier,
} from "./types";
import { ScopedProjectionLiveSupervisor } from "./scoped-projection-live-supervisor";

const scope = (projectId: string): ProjectionScope => ({
  kind: "project",
  libraryId: "library-1",
  projectId,
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const barrierFor = (
  scopes: readonly ProjectionScope[],
  commitHead: number,
): ProjectionLiveBarrier => ({
  store_epoch: "epoch-1",
  core_generation: "generation-1",
  commit_head: commitHead,
  authorization_scopes: scopes.map((candidate) => candidate.kind === "library"
    ? {
        kind: "library" as const,
        library_id: candidate.libraryId,
      }
    : {
        kind: "project" as const,
        library_id: candidate.libraryId,
        project_id: candidate.projectId,
      }),
});

interface PendingLease {
  readonly scopes: readonly ProjectionScope[];
  readonly opened: Deferred<CoreProjectionEventSubscription>;
  readonly done: Deferred<void>;
  readonly close: Mock<() => void>;
  readonly onEvent: (event: CoreEventEnvelope) => void;
}

describe("ScopedProjectionLiveSupervisor", () => {
  test("keeps the old lease authoritative until the replacement barrier", async () => {
    const leases: PendingLease[] = [];
    const onPacket = vi.fn();
    const onBarrier = vi.fn();
    const supervisor = new ScopedProjectionLiveSupervisor({
      open: async (scopes, onEvent) => {
        const lease: PendingLease = {
          scopes,
          opened: deferred<CoreProjectionEventSubscription>(),
          done: deferred<void>(),
          close: vi.fn<() => void>(),
          onEvent,
        };
        leases.push(lease);
        return await lease.opened.promise;
      },
      onPacket,
      onBarrier,
      onRepair: vi.fn(),
      retryDelayMs: 10,
    });

    supervisor.setScopes([scope("project-1")]);
    await vi.waitFor(() => expect(leases).toHaveLength(1));
    leases[0]!.opened.resolve({
      barrier: barrierFor(leases[0]!.scopes, 1),
      done: leases[0]!.done.promise,
      close: leases[0]!.close,
    });
    await vi.waitFor(() => expect(onBarrier).toHaveBeenCalledOnce());

    supervisor.setScopes([scope("project-1"), scope("project-2")]);
    await vi.waitFor(() => expect(leases).toHaveLength(2));
    expect(leases[0]!.close).not.toHaveBeenCalled();

    leases[0]!.onEvent({} as CoreEventEnvelope);
    leases[1]!.onEvent({} as CoreEventEnvelope);
    expect(onPacket).toHaveBeenCalledOnce();

    leases[1]!.opened.resolve({
      barrier: barrierFor(leases[1]!.scopes, 2),
      done: leases[1]!.done.promise,
      close: leases[1]!.close,
    });
    await vi.waitFor(() => expect(onBarrier).toHaveBeenCalledTimes(2));
    expect(leases[0]!.close).toHaveBeenCalledOnce();
    expect(onPacket).toHaveBeenCalledTimes(2);
    expect(onBarrier).toHaveBeenLastCalledWith(
      expect.objectContaining({ commit_head: 2 }),
      [scope("project-1"), scope("project-2")],
      [scope("project-2")],
    );

    leases[0]!.onEvent({} as CoreEventEnvelope);
    expect(onPacket).toHaveBeenCalledTimes(2);
    leases[0]!.done.resolve(undefined);
    await Promise.resolve();
    expect(supervisor.diagnostics()).toMatchObject({
      activeScopes: 2,
      connected: true,
    });
    supervisor.stop();
  });

  test("repairs every desired scope after a real interruption", async () => {
    const leases: PendingLease[] = [];
    const onBarrier = vi.fn();
    const supervisor = new ScopedProjectionLiveSupervisor({
      open: async (scopes, onEvent) => {
        const lease: PendingLease = {
          scopes,
          opened: deferred<CoreProjectionEventSubscription>(),
          done: deferred<void>(),
          close: vi.fn<() => void>(),
          onEvent,
        };
        leases.push(lease);
        return await lease.opened.promise;
      },
      onPacket: vi.fn(),
      onBarrier,
      onRepair: vi.fn(),
      retryDelayMs: 10,
    });
    const desired = [scope("project-1"), scope("project-2")];

    supervisor.setScopes(desired);
    await vi.waitFor(() => expect(leases).toHaveLength(1));
    leases[0]!.opened.resolve({
      barrier: barrierFor(desired, 1),
      done: leases[0]!.done.promise,
      close: leases[0]!.close,
    });
    await vi.waitFor(() => expect(onBarrier).toHaveBeenCalledOnce());
    leases[0]!.done.resolve(undefined);
    await vi.waitFor(() => expect(leases).toHaveLength(2));
    leases[1]!.opened.resolve({
      barrier: barrierFor(desired, 2),
      done: leases[1]!.done.promise,
      close: leases[1]!.close,
    });

    await vi.waitFor(() => expect(onBarrier).toHaveBeenCalledTimes(2));
    expect(onBarrier).toHaveBeenLastCalledWith(
      expect.objectContaining({ commit_head: 2 }),
      desired,
      desired,
    );
    supervisor.stop();
  });

  test("reuses the active lease when scope churn returns to its exact set", async () => {
    const leases: PendingLease[] = [];
    const onBarrier = vi.fn();
    const supervisor = new ScopedProjectionLiveSupervisor({
      open: async (scopes, onEvent) => {
        const lease: PendingLease = {
          scopes,
          opened: deferred<CoreProjectionEventSubscription>(),
          done: deferred<void>(),
          close: vi.fn<() => void>(),
          onEvent,
        };
        leases.push(lease);
        return await lease.opened.promise;
      },
      onPacket: vi.fn(),
      onBarrier,
      onRepair: vi.fn(),
      retryDelayMs: 10,
    });
    const stable = [scope("project-1")];

    supervisor.setScopes(stable);
    await vi.waitFor(() => expect(leases).toHaveLength(1));
    leases[0]!.opened.resolve({
      barrier: barrierFor(stable, 1),
      done: leases[0]!.done.promise,
      close: leases[0]!.close,
    });
    await vi.waitFor(() => expect(onBarrier).toHaveBeenCalledOnce());

    supervisor.setScopes([...stable, scope("project-2")]);
    await vi.waitFor(() => expect(leases).toHaveLength(2));
    supervisor.setScopes(stable);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(leases).toHaveLength(2);
    expect(leases[0]!.close).not.toHaveBeenCalled();

    leases[0]!.done.resolve(undefined);
    await vi.waitFor(() => expect(leases).toHaveLength(3));
    expect(leases[2]!.scopes).toEqual(stable);
    supervisor.stop();
  });

  test("deduplicates scopes and rejects an unbounded broker request", async () => {
    const openedScopes: Array<readonly ProjectionScope[]> = [];
    const supervisor = new ScopedProjectionLiveSupervisor({
      open: async (scopes) => {
        openedScopes.push(scopes);
        return {
          barrier: barrierFor(scopes, 0),
          done: new Promise<void>(() => undefined),
          close: vi.fn(),
        };
      },
      onPacket: vi.fn(),
      onBarrier: vi.fn(),
      onRepair: vi.fn(),
    });
    supervisor.setScopes([scope("project-1"), scope("project-1")]);
    await vi.waitFor(() => expect(openedScopes).toHaveLength(1));
    expect(openedScopes[0]).toEqual([scope("project-1")]);
    expect(() => supervisor.setScopes(
      Array.from({ length: 201 }, (_, index) => scope(`project-${index}`)),
    )).toThrow(RangeError);
    supervisor.stop();
  });
});
