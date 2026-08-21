import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { LocalGitCommandRunner } from "./git-command-runner";
import { GitRepositoryRegistry } from "./repository-registry";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("GitRepositoryRegistry", () => {
  it("canonicalizes cwd aliases to one worktree owner", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodex-git-registry-"));
    temporaryDirectories.push(root);
    const nested = path.join(root, "nested", "directory");
    await mkdir(nested, { recursive: true });
    await execFileAsync("git", ["init", "-q", root]);
    const registry = new GitRepositoryRegistry(new LocalGitCommandRunner());

    const fromRoot = await registry.get(root);
    const fromNested = await registry.get(nested);

    expect(fromRoot).not.toBeNull();
    expect(fromNested).toBe(fromRoot);
    expect(fromRoot?.identity.root).toBe(await realpath(root));
    registry.dispose();
  });

  it("returns null for an ordinary directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodex-not-git-"));
    temporaryDirectories.push(root);
    const registry = new GitRepositoryRegistry(new LocalGitCommandRunner());

    await expect(registry.get(root)).resolves.toBeNull();
    registry.dispose();
  });
});
