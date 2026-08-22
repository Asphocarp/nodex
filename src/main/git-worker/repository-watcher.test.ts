import path from "node:path";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect, vi } from "vite-plus/test";
import type {
  FileWatchChange,
  FileWatchClosed,
  FileWatchHost,
  FileWatchSession,
} from "../file-watch-host";
import {
  GIT_REVIEW_REPOSITORY_CHANGE_DELAY_MS,
  GIT_REVIEW_WATCH_RETRY_MS,
  makeGitReviewRepositoryWatcher,
  type GitReviewRepositoryChangedEvent,
  type GitReviewWatchRoots,
} from "./repository-watcher";

const ROOT = path.join(path.sep, "repo");
const GIT_DIR = path.join(ROOT, ".git", "worktrees", "feature");
const COMMON_DIR = path.join(ROOT, ".git");
const ROOTS: GitReviewWatchRoots = {
  root: ROOT,
  gitDir: GIT_DIR,
  commonDir: COMMON_DIR,
  headPath: path.join(GIT_DIR, "HEAD"),
  indexPath: path.join(GIT_DIR, "index"),
  syncedBranchPath: path.join(GIT_DIR, "codex-synced-branch.json"),
};

interface WatchInput {
  readonly path: string;
  readonly recursive: boolean;
  readonly renameEventHandling: "changed-path" | "changed-path-with-parent-directory";
  readonly onChange: (change: FileWatchChange) => void;
}

class FakeSession implements FileWatchSession {
  readonly coverage;
  readonly path;
  readonly closed: Promise<FileWatchClosed>;
  readonly dispose = vi.fn(async () => {
    this.close({ reason: "disposed" });
  });
  private resolveClosed!: (closed: FileWatchClosed) => void;
  private settled = false;

  get isClosed(): boolean {
    return this.settled;
  }

  constructor(
    readonly input: WatchInput,
    recursiveCoverage = input.recursive,
  ) {
    this.path = input.path;
    this.coverage = {
      recursive: recursiveCoverage,
      typedPathChanges: false as const,
    };
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  emit(changedPaths: readonly string[]): void {
    this.input.onChange({ changedPaths });
  }

  close(closed: FileWatchClosed): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveClosed(closed);
  }
}

class FakeFileWatchHost implements FileWatchHost {
  readonly sessions: FakeSession[] = [];
  readonly starts: string[] = [];
  readonly failuresRemaining = new Map<string, number>();

  async startFileWatch(input: WatchInput): Promise<FileWatchSession> {
    this.starts.push(`${input.path}:${input.recursive}`);
    const remaining = this.failuresRemaining.get(input.path) ?? 0;
    if (remaining > 0) {
      this.failuresRemaining.set(input.path, remaining - 1);
      throw new Error(`Could not watch ${input.path}`);
    }
    const session = new FakeSession(input);
    this.sessions.push(session);
    return session;
  }

  activeSessions(
    input: {
      readonly path?: string;
      readonly recursive?: boolean;
    } = {},
  ): FakeSession[] {
    return this.sessions.filter(
      (session) =>
        (input.path === undefined || session.input.path === input.path) &&
        (input.recursive === undefined || session.input.recursive === input.recursive) &&
        !session.isClosed,
    );
  }

  emitEverywhere(changedPaths: readonly string[]): void {
    for (const session of this.activeSessions()) session.emit(changedPaths);
  }
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("makeGitReviewRepositoryWatcher", () => {
  it.effect("watches exact Git targets and emits all seven semantic change types", () =>
    Effect.gen(function* () {
      const host = new FakeFileWatchHost();
      const events: GitReviewRepositoryChangedEvent[] = [];
      yield* makeGitReviewRepositoryWatcher({
        roots: ROOTS,
        host,
        onChange: (event) => {
          events.push(event);
        },
      });

      expect(
        host.activeSessions({
          path: path.dirname(ROOTS.headPath),
          recursive: false,
        }).length,
      ).toBeGreaterThan(0);
      expect(
        host.activeSessions({
          path: path.join(COMMON_DIR, "refs", "heads"),
          recursive: true,
        }),
      ).toHaveLength(1);
      expect(
        host.activeSessions({
          path: path.join(COMMON_DIR, "refs"),
          recursive: true,
        }),
      ).toHaveLength(1);
      expect(host.activeSessions({ path: ROOT, recursive: true })).toHaveLength(1);
      expect(
        host.activeSessions({ path: ROOT, recursive: true })[0]?.input.renameEventHandling,
      ).toBe("changed-path-with-parent-directory");

      host.emitEverywhere([ROOTS.headPath]);
      host.emitEverywhere([ROOTS.indexPath]);
      host.emitEverywhere([path.join(COMMON_DIR, "FETCH_HEAD")]);
      host.emitEverywhere([path.join(COMMON_DIR, "info", "attributes")]);
      host.emitEverywhere([ROOTS.syncedBranchPath]);
      host.emitEverywhere([path.join(COMMON_DIR, "worktrees", "other", "HEAD")]);
      host.emitEverywhere([path.join(ROOT, "src", "example.ts")]);

      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* TestClock.adjust(GIT_REVIEW_REPOSITORY_CHANGE_DELAY_MS - 1);
      expect(events).toHaveLength(0);
      yield* TestClock.adjust(1);
      expect(new Set(events.map((event) => event.changeType))).toEqual(
        new Set([
          "config",
          "head",
          "index",
          "remote-refs",
          "working-tree",
          "synced-branch",
          "worktree-topology",
        ]),
      );
    }),
  );

  it.effect("deduplicates working-tree ancestors and collapses more than 64 paths", () =>
    Effect.gen(function* () {
      const host = new FakeFileWatchHost();
      const events: GitReviewRepositoryChangedEvent[] = [];
      yield* makeGitReviewRepositoryWatcher({
        roots: ROOTS,
        host,
        onChange: (event) => {
          events.push(event);
        },
      });
      const workingTreeSession = host.activeSessions({ path: ROOT, recursive: true })[0];
      if (!workingTreeSession) throw new Error("Missing working-tree watcher.");

      workingTreeSession.emit([path.join(ROOT, "src", "nested", "child.ts")]);
      workingTreeSession.emit([path.join(ROOT, "src", "nested")]);
      for (let index = 0; index < 65; index += 1) {
        workingTreeSession.emit([
          path.join(ROOT, index % 2 === 0 ? "src" : "tests", `${index}.ts`),
        ]);
      }

      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* TestClock.adjust(GIT_REVIEW_REPOSITORY_CHANGE_DELAY_MS);
      expect(events).toEqual([
        {
          changeType: "working-tree",
          changedPaths: [path.join(ROOT, "src"), path.join(ROOT, "tests")],
        },
      ]);
    }),
  );

  it.effect("serializes one semantic type and starts a new fixed window afterward", () =>
    Effect.gen(function* () {
      const host = new FakeFileWatchHost();
      const firstEmission = deferred();
      const events: GitReviewRepositoryChangedEvent[] = [];
      yield* makeGitReviewRepositoryWatcher({
        roots: ROOTS,
        host,
        onChange: (event) => {
          events.push(event);
          return events.length === 1 ? firstEmission.promise : undefined;
        },
      });
      const workingTreeSession = host.activeSessions({ path: ROOT, recursive: true })[0];
      if (!workingTreeSession) throw new Error("Missing working-tree watcher.");

      workingTreeSession.emit([path.join(ROOT, "first.ts")]);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* TestClock.adjust(GIT_REVIEW_REPOSITORY_CHANGE_DELAY_MS);
      workingTreeSession.emit([path.join(ROOT, "second.ts")]);
      yield* TestClock.adjust(GIT_REVIEW_REPOSITORY_CHANGE_DELAY_MS * 2);
      expect(events).toHaveLength(1);

      firstEmission.resolve();
      yield* Effect.yieldNow;
      yield* TestClock.adjust(GIT_REVIEW_REPOSITORY_CHANGE_DELAY_MS - 1);
      expect(events).toHaveLength(1);
      yield* TestClock.adjust(1);
      expect(events).toEqual([
        {
          changeType: "working-tree",
          changedPaths: [path.join(ROOT, "first.ts")],
        },
        {
          changeType: "working-tree",
          changedPaths: [path.join(ROOT, "second.ts")],
        },
      ]);
    }),
  );

  it.effect("retries failed sessions and emits a synthetic unknown-path change", () =>
    Effect.gen(function* () {
      const host = new FakeFileWatchHost();
      const events: GitReviewRepositoryChangedEvent[] = [];
      const recoveryStates: boolean[] = [];
      const watcher = yield* makeGitReviewRepositoryWatcher({
        roots: ROOTS,
        host,
        onChange: (event) => {
          events.push(event);
        },
        onRequiresRecoveryChanged: (requiresRecovery) => {
          recoveryStates.push(requiresRecovery);
        },
      });
      const workingTreeSession = host.activeSessions({ path: ROOT, recursive: true })[0];
      if (!workingTreeSession) throw new Error("Missing working-tree watcher.");

      host.failuresRemaining.set(ROOT, 1);
      workingTreeSession.close({
        reason: "watch-error",
        error: new Error("watch overflow"),
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(recoveryStates.at(-1)).toBe(true);
      expect(watcher.requiresRecovery).toBe(true);

      yield* TestClock.adjust(GIT_REVIEW_WATCH_RETRY_MS - 1);
      expect(host.activeSessions({ path: ROOT, recursive: true })).toHaveLength(0);
      yield* TestClock.adjust(1);
      expect(host.activeSessions({ path: ROOT, recursive: true })).toHaveLength(1);
      expect(recoveryStates.at(-1)).toBe(false);

      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* TestClock.adjust(GIT_REVIEW_REPOSITORY_CHANGE_DELAY_MS);
      expect(events.at(-1)).toEqual({ changeType: "working-tree" });
    }),
  );

  it.effect("awaits one immediate recovery attempt", () =>
    Effect.gen(function* () {
      const host = new FakeFileWatchHost();
      const watcher = yield* makeGitReviewRepositoryWatcher({
        roots: ROOTS,
        host,
        onChange: () => undefined,
      });
      const workingTreeSession = host.activeSessions({ path: ROOT, recursive: true })[0];
      if (!workingTreeSession) throw new Error("Missing working-tree watcher.");

      host.failuresRemaining.set(ROOT, 1);
      workingTreeSession.close({ reason: "watch-error", error: new Error("watch overflow") });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(watcher.requiresRecovery).toBe(true);

      yield* Effect.promise(() => watcher.recover());

      expect(host.activeSessions({ path: ROOT, recursive: true })).toHaveLength(1);
      expect(watcher.requiresRecovery).toBe(false);
    }),
  );

  it.effect("closes every active native session with its Scope", () =>
    Effect.gen(function* () {
      const parentScope = yield* Scope.Scope;
      const watcherScope = yield* Scope.fork(parentScope);
      const host = new FakeFileWatchHost();
      const watcher = yield* makeGitReviewRepositoryWatcher({
        roots: ROOTS,
        host,
        onChange: () => undefined,
      }).pipe(Scope.provide(watcherScope));
      const sessions = host.activeSessions();
      expect(sessions.length).toBeGreaterThan(0);

      yield* Scope.close(watcherScope, Exit.void);

      expect(host.activeSessions()).toHaveLength(0);
      expect(sessions.every((session) => session.dispose.mock.calls.length === 1)).toBe(true);
      yield* Effect.promise(() => watcher.recover());
      expect(host.activeSessions()).toHaveLength(0);
    }),
  );
});
