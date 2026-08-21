import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { CodexCrossHostThreadHandoffService } from "./codex-cross-host-thread-handoff";
import { CodexExecutionHostRegistry } from "./codex-execution-host-registry";
import { CodexLocalExecutionHostFileTransfer } from "./codex-execution-host-file-transfer";
import { createInProcessCodexWorktreeWorkerPort } from "./codex-worktree-worker-operation";

const run = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run("git", args, { cwd, env: process.env })).stdout.trim();
}

async function fixture(): Promise<{
  readonly root: string;
  readonly source: string;
  readonly destination: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "nodex-cross-host-service-"));
  roots.push(root);
  const bare = path.join(root, "origin.git");
  const source = path.join(root, "source", "repository");
  const destination = path.join(root, "destination", "repository");
  await mkdir(path.dirname(source), { recursive: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await git(root, "init", "--bare", bare);
  await git(root, "clone", bare, source);
  await git(source, "config", "user.name", "Nodex Test");
  await git(source, "config", "user.email", "nodex@example.test");
  await writeFile(path.join(source, "tracked.txt"), "base\n");
  await git(source, "add", ".");
  await git(source, "commit", "-m", "base");
  await git(source, "push", "origin", "HEAD:main");
  await git(root, "clone", "--branch", "main", bare, destination);
  return { root, source, destination };
}

describe("CodexCrossHostThreadHandoffService", () => {
  test("relays verified Git and rollout state and retains only the committed destination", async () => {
    const { root, source, destination } = await fixture();
    await writeFile(path.join(source, "tracked.txt"), "moved\n");
    await writeFile(path.join(source, "untracked.txt"), "untracked\n");
    const relayBaseRoot = path.join(root, "main-private", "handoffs");
    const sourceCodexHome = path.join(root, "source", "codex-home");
    const destinationCodexHome = path.join(root, "destination", "codex-home");
    const sourceRolloutPath = path.join(
      sourceCodexHome,
      "sessions",
      "2026",
      "08",
      "14",
      "thread.jsonl",
    );
    await mkdir(path.dirname(sourceRolloutPath), { recursive: true });
    await writeFile(sourceRolloutPath, '{"type":"session_meta","id":"thread"}\n');

    const registry = new CodexExecutionHostRegistry();
    for (const host of [
      {
        id: "source",
        codexHome: sourceCodexHome,
        repository: source,
        root: path.join(root, "source"),
      },
      {
        id: "destination",
        codexHome: destinationCodexHome,
        repository: destination,
        root: path.join(root, "destination"),
      },
    ]) {
      const stagingRoot = path.join(host.codexHome, "nodex-handoffs");
      registry.register({
        hostId: host.id,
        kind: "local",
        nodexHome: path.join(host.root, "nodex-home"),
        codexHome: host.codexHome,
        managedRoot: path.join(host.root, "worktrees"),
        handoffStagingRoot: stagingRoot,
        repositoryRoots: [host.repository],
        worktreeWorker: createInProcessCodexWorktreeWorkerPort({ hostId: host.id }),
        fileTransfer: new CodexLocalExecutionHostFileTransfer({
          hostId: host.id,
          stagingRoot,
          allowedReadRoots: [host.root, relayBaseRoot],
        }),
        capabilities: ["export-handoff", "import-handoff", "cleanup-transfer-handoff"],
      });
    }

    const service = new CodexCrossHostThreadHandoffService({
      executionHosts: registry,
      relayBaseRoot,
    });
    const allocated: string[] = [];
    const prepared = await service.prepare({
      operationId: "transfer-1",
      threadId: "thread",
      threadTitle: "Cross host",
      projectId: "project",
      sourceHostId: "source",
      destinationHostId: "destination",
      sourceCwd: source,
      sourceWorkspaceRoot: source,
      sourceManagedWorktreePath: null,
      sourceRolloutPath,
      destinationRepositoryPaths: [destination],
      onPathAllocated: ({ worktreeGitRoot }) => allocated.push(worktreeGitRoot),
      onPhase: () => undefined,
    });

    expect(allocated).toEqual([prepared.managedWorktreePath]);
    await expect(
      readFile(path.join(prepared.destinationWorkspaceRoot, "tracked.txt"), "utf8"),
    ).resolves.toBe("moved\n");
    await expect(
      readFile(path.join(prepared.destinationWorkspaceRoot, "untracked.txt"), "utf8"),
    ).resolves.toBe("untracked\n");
    await expect(readFile(prepared.destinationRollout.path, "utf8")).resolves.toBe(
      '{"type":"session_meta","id":"thread"}\n',
    );

    await expect(service.cleanup(prepared, "committed")).resolves.toEqual([]);
    await expect(readFile(prepared.destinationRollout.path, "utf8")).resolves.toContain(
      '"id":"thread"',
    );
    await expect(
      readFile(path.join(prepared.destinationWorkspaceRoot, "tracked.txt"), "utf8"),
    ).resolves.toBe("moved\n");
    await expect(
      git(source, "rev-parse", "--verify", prepared.sourceTemporaryRef),
    ).rejects.toThrow();
    await expect(
      git(destination, "rev-parse", "--verify", prepared.destinationTemporaryRef),
    ).rejects.toThrow();
    await expect(readFile(path.join(prepared.relayRoot, "source.bundle"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
