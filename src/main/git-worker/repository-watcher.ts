import path from "node:path";
import type { FileWatchHost, FileWatchSession } from "../file-watch-host";
import { getLogger } from "../logging/logger";

export const GIT_REVIEW_REPOSITORY_CHANGE_DELAY_MS = 1_000;
export const GIT_REVIEW_WATCH_RETRY_MS = 1_000;
export const GIT_REVIEW_MAX_WORKING_TREE_PATHS = 64;

const WORKTREE_TOPOLOGY_FILES = new Set([
  "HEAD",
  "commondir",
  "gitdir",
  "locked",
]);

const logger = getLogger({
  subsystem: "git-review",
  component: "repository-watcher",
});

export type GitReviewRepositoryChange =
  | "config"
  | "head"
  | "index"
  | "remote-refs"
  | "working-tree"
  | "synced-branch"
  | "worktree-topology";

export interface GitReviewWatchRoots {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly headPath: string;
  readonly indexPath: string;
  readonly syncedBranchPath: string;
}

export interface GitReviewRepositoryChangedEvent {
  readonly changeType: GitReviewRepositoryChange;
  readonly changedPaths?: readonly string[];
}

export interface GitReviewRepositoryWatcher {
  readonly requiresRecovery: boolean;
  start(): Promise<void>;
  dispose(): void;
}

export interface GitReviewRepositoryWatcherOptions {
  readonly roots: GitReviewWatchRoots;
  readonly host: FileWatchHost;
  readonly onChange: (
    event: GitReviewRepositoryChangedEvent,
  ) => void | Promise<void>;
  readonly onRequiresRecoveryChanged?: (requiresRecovery: boolean) => void;
}

interface WatchTarget {
  readonly changeType: GitReviewRepositoryChange;
  readonly path: string;
  readonly recursive: boolean;
  readonly shouldHandleChangedPath: (changedPath: string) => boolean;
  readonly watchPath: string;
  retryTimer: ReturnType<typeof setTimeout> | null;
  session: FileWatchSession | null;
  sessionStartPromise: Promise<void> | null;
}

function isPathInside(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

function isUnlockedPath(directory: string, candidate: string): boolean {
  return !candidate.endsWith(".lock") && isPathInside(directory, candidate);
}

function isWorktreeTopologyPath(
  worktreesDirectory: string,
  candidate: string,
): boolean {
  if (!isPathInside(worktreesDirectory, candidate)) return false;
  const relative = path.relative(worktreesDirectory, candidate);
  if (relative === "") return true;
  const parts = relative.split(path.sep);
  return parts.length === 1
    || (parts.length === 2 && WORKTREE_TOPOLOGY_FILES.has(parts[1] ?? ""));
}

export function shouldRefreshGitReviewSummary(
  change: GitReviewRepositoryChange,
): boolean {
  return change === "config"
    || change === "head"
    || change === "index"
    || change === "remote-refs"
    || change === "working-tree";
}

export class NodeGitReviewRepositoryWatcher
implements GitReviewRepositoryWatcher {
  private readonly watchTargets: WatchTarget[] = [];
  private readonly pendingChangeCounts: Record<GitReviewRepositoryChange, number> = {
    config: 0,
    head: 0,
    index: 0,
    "remote-refs": 0,
    "synced-branch": 0,
    "worktree-topology": 0,
    "working-tree": 0,
  };
  private readonly changeTimers = new Map<
    GitReviewRepositoryChange,
    ReturnType<typeof setTimeout>
  >();
  private readonly activeChangeEmissions = new Set<GitReviewRepositoryChange>();
  private pendingWorkingTreePaths: Set<string> | null = new Set();
  private lastRequiresRecovery: boolean | null = null;
  private disposed = false;

  constructor(private readonly options: GitReviewRepositoryWatcherOptions) {}

  get requiresRecovery(): boolean {
    return this.watchTargets.some(
      (target) => target.session === null
        || (target.recursive && !target.session.coverage.recursive),
    );
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    if (this.watchTargets.length > 0) {
      await Promise.all(
        this.watchTargets.map(async (target) => {
          if (target.session !== null) return;
          await this.tryStartWatchSession(target, true);
        }),
      );
      return;
    }

    const { commonDir, gitDir, headPath, indexPath, root, syncedBranchPath } =
      this.options.roots;
    await this.tryWatchFile(headPath, "head");

    const commonHeadPath = path.join(commonDir, "HEAD");
    if (commonHeadPath !== headPath) {
      await this.tryWatchFile(commonHeadPath, "head");
    }

    await this.tryWatchFile(indexPath, "index");
    await this.tryWatchFile(
      path.join(commonDir, "FETCH_HEAD"),
      "remote-refs",
    );
    await this.tryWatchFile(
      path.join(commonDir, "packed-refs"),
      "remote-refs",
    );

    const localHeadsDirectory = path.join(commonDir, "refs", "heads");
    await this.tryWatchDirectory(
      localHeadsDirectory,
      "head",
      (changedPath) => isUnlockedPath(localHeadsDirectory, changedPath),
    );

    const refsDirectory = path.join(commonDir, "refs");
    const remoteRefsDirectory = path.join(refsDirectory, "remotes");
    await this.tryWatchDirectory(
      refsDirectory,
      "remote-refs",
      (changedPath) => isUnlockedPath(remoteRefsDirectory, changedPath),
    );

    await this.tryWatchFile(path.join(commonDir, "config"), "config");
    const infoDirectory = path.join(commonDir, "info");
    const excludePath = path.join(infoDirectory, "exclude");
    const attributesPath = path.join(infoDirectory, "attributes");
    await this.tryWatchDirectory(
      infoDirectory,
      "config",
      (changedPath) => changedPath === excludePath || changedPath === attributesPath,
    );

    await this.tryWatchFile(path.join(gitDir, "config.worktree"), "config");
    await this.tryWatchFile(syncedBranchPath, "synced-branch");

    const worktreesDirectory = path.join(commonDir, "worktrees");
    await this.tryWatchDirectory(
      commonDir,
      "worktree-topology",
      (changedPath) => isWorktreeTopologyPath(worktreesDirectory, changedPath),
    );
    await this.tryWatchDirectory(
      root,
      "working-tree",
      (changedPath) => !this.isGitInternalPath(changedPath),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const target of this.watchTargets) this.disposeWatchTarget(target);
    this.watchTargets.length = 0;
    for (const timer of this.changeTimers.values()) clearTimeout(timer);
    this.changeTimers.clear();
  }

  private async tryWatchFile(
    targetPath: string,
    changeType: GitReviewRepositoryChange,
  ): Promise<void> {
    const target: WatchTarget = {
      changeType,
      path: targetPath,
      recursive: false,
      retryTimer: null,
      session: null,
      sessionStartPromise: null,
      shouldHandleChangedPath: (changedPath) => changedPath === targetPath,
      watchPath: path.dirname(targetPath),
    };
    this.watchTargets.push(target);
    await this.tryStartWatchSession(target, false);
  }

  private async tryWatchDirectory(
    targetPath: string,
    changeType: GitReviewRepositoryChange,
    shouldHandleChangedPath: (changedPath: string) => boolean,
  ): Promise<void> {
    const target: WatchTarget = {
      changeType,
      path: targetPath,
      recursive: true,
      retryTimer: null,
      session: null,
      sessionStartPromise: null,
      shouldHandleChangedPath,
      watchPath: targetPath,
    };
    this.watchTargets.push(target);
    await this.tryStartWatchSession(target, false);
  }

  private async tryStartWatchSession(
    target: WatchTarget,
    isRetry: boolean,
  ): Promise<void> {
    if (this.disposed || target.retryTimer !== null) return;
    if (target.sessionStartPromise !== null) {
      await target.sessionStartPromise;
      if (isRetry && !this.disposed && target.session === null) {
        this.scheduleWatchSessionRetry(target);
      }
      return;
    }

    const startPromise = this.startWatchSession(target, isRetry);
    target.sessionStartPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (target.sessionStartPromise === startPromise) {
        target.sessionStartPromise = null;
      }
    }
  }

  private async startWatchSession(
    target: WatchTarget,
    isRetry: boolean,
  ): Promise<void> {
    try {
      const workingTree = target.changeType === "working-tree";
      const session = await this.options.host.startFileWatch({
        path: target.watchPath,
        recursive: target.recursive,
        renameEventHandling: workingTree
          ? "changed-path-with-parent-directory"
          : "changed-path",
        onChange: ({ changedPaths }) => {
          const acceptedPaths = changedPaths.flatMap((changedPath) => {
            if (!target.shouldHandleChangedPath(changedPath)) return [];
            if (!workingTree) return [changedPath];
            const affectedPath = this.getAffectedWorkingTreePath(changedPath);
            return affectedPath === null ? [] : [affectedPath];
          });
          if (changedPaths.length > 0 && acceptedPaths.length === 0) return;
          const includesRoot = workingTree
            && acceptedPaths.includes(this.options.roots.root);
          this.handleFileWatchEvent(
            target,
            changedPaths.length === 0 || includesRoot
              ? undefined
              : acceptedPaths,
          );
        },
      });

      if (this.disposed || !this.watchTargets.includes(target)) {
        await session.dispose();
        return;
      }

      target.session = session;
      this.updateRequiresRecovery();
      void session.closed.then((closed) => {
        if (
          this.disposed
          || target.session !== session
          || !this.watchTargets.includes(target)
        ) return;
        if (closed.reason === "watch-error") {
          logger.warn("Git repository watcher session failed", {
            path: target.path,
            error: closed.error,
          });
        }
        target.session = null;
        this.updateRequiresRecovery();
        void this.tryStartWatchSession(target, true);
      });

      if (isRetry) this.handleFileWatchEvent(target);
    } catch (error) {
      logger.warn("Could not watch Git repository path", {
        path: target.path,
        error,
      });
      if (this.disposed) return;
      this.updateRequiresRecovery();
      this.scheduleWatchSessionRetry(target);
    }
  }

  private scheduleWatchSessionRetry(target: WatchTarget): void {
    if (this.disposed || target.retryTimer !== null) return;
    target.retryTimer = setTimeout(() => {
      target.retryTimer = null;
      if (this.disposed || target.session !== null) return;
      void this.tryStartWatchSession(target, true);
    }, GIT_REVIEW_WATCH_RETRY_MS);
  }

  private updateRequiresRecovery(): void {
    const next = this.requiresRecovery;
    if (this.lastRequiresRecovery === next) return;
    this.lastRequiresRecovery = next;
    this.options.onRequiresRecoveryChanged?.(next);
  }

  private handleFileWatchEvent(
    target: WatchTarget,
    changedPaths?: readonly string[],
  ): void {
    this.pendingChangeCounts[target.changeType] += 1;
    if (target.changeType === "working-tree") {
      if (changedPaths === undefined) {
        this.pendingWorkingTreePaths = null;
      } else if (this.pendingWorkingTreePaths !== null) {
        for (const changedPath of changedPaths) {
          this.addPendingWorkingTreePath(changedPath);
          if (this.pendingWorkingTreePaths === null) break;
        }
      }
    }
    this.scheduleRepositoryChange(target.changeType);
  }

  private addPendingWorkingTreePath(changedPath: string): void {
    const pendingPaths = this.pendingWorkingTreePaths;
    if (pendingPaths === null) return;
    if (
      [...pendingPaths].some((existingPath) =>
        isPathInside(existingPath, changedPath)
      )
    ) return;

    for (const existingPath of pendingPaths) {
      if (isPathInside(changedPath, existingPath)) {
        pendingPaths.delete(existingPath);
      }
    }
    pendingPaths.add(changedPath);
    if (pendingPaths.size <= GIT_REVIEW_MAX_WORKING_TREE_PATHS) return;

    const topLevelPaths = new Set<string>();
    for (const pendingPath of pendingPaths) {
      const relative = path.relative(this.options.roots.root, pendingPath);
      if (
        relative === ""
        || relative === ".."
        || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative)
      ) {
        this.pendingWorkingTreePaths = null;
        return;
      }
      const [topLevelName] = relative.split(path.sep, 1);
      if (!topLevelName) {
        this.pendingWorkingTreePaths = null;
        return;
      }
      topLevelPaths.add(path.join(this.options.roots.root, topLevelName));
      if (topLevelPaths.size > GIT_REVIEW_MAX_WORKING_TREE_PATHS) {
        this.pendingWorkingTreePaths = null;
        return;
      }
    }
    this.pendingWorkingTreePaths = topLevelPaths;
  }

  private scheduleRepositoryChange(changeType: GitReviewRepositoryChange): void {
    if (
      this.disposed
      || this.activeChangeEmissions.has(changeType)
      || this.changeTimers.has(changeType)
    ) return;

    const timer = setTimeout(() => {
      this.changeTimers.delete(changeType);
      void this.emitRepositoryChange(changeType);
    }, GIT_REVIEW_REPOSITORY_CHANGE_DELAY_MS);
    this.changeTimers.set(changeType, timer);
  }

  private async emitRepositoryChange(
    changeType: GitReviewRepositoryChange,
  ): Promise<void> {
    this.activeChangeEmissions.add(changeType);
    this.pendingChangeCounts[changeType] = 0;
    const changedPaths = changeType === "working-tree"
      && this.pendingWorkingTreePaths !== null
      ? [...this.pendingWorkingTreePaths]
      : undefined;
    if (changeType === "working-tree") {
      this.pendingWorkingTreePaths = new Set();
    }

    try {
      await this.options.onChange({
        changeType,
        ...(changedPaths === undefined ? {} : { changedPaths }),
      });
    } finally {
      this.activeChangeEmissions.delete(changeType);
      if (this.pendingChangeCounts[changeType] > 0) {
        this.scheduleRepositoryChange(changeType);
      }
    }
  }

  private isGitInternalPath(changedPath: string): boolean {
    return isPathInside(this.options.roots.commonDir, changedPath)
      || isPathInside(path.join(this.options.roots.root, ".git"), changedPath);
  }

  private getAffectedWorkingTreePath(changedPath: string): string | null {
    const relativeParts = path
      .relative(this.options.roots.root, changedPath)
      .split(path.sep);
    const gitPartIndex = relativeParts.indexOf(".git");
    if (gitPartIndex < 1) return changedPath;
    const metadataName = relativeParts[gitPartIndex + 1];
    if (
      metadataName !== "HEAD"
      && metadataName !== "packed-refs"
      && metadataName !== "refs"
    ) return null;
    return path.join(
      this.options.roots.root,
      ...relativeParts.slice(0, gitPartIndex),
    );
  }

  private disposeWatchTarget(target: WatchTarget): void {
    if (target.retryTimer !== null) {
      clearTimeout(target.retryTimer);
      target.retryTimer = null;
    }
    const session = target.session;
    target.session = null;
    target.sessionStartPromise = null;
    void session?.dispose().catch((error) => {
      logger.warn("Could not dispose Git repository watcher session", { error });
    });
  }
}
