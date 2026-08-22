import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect } from "vite-plus/test";
import { LocalGitCommandRunner } from "./git-command-runner";
import { makeGitRepositoryRegistry } from "./repository-registry";

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
  it.effect("canonicalizes cwd aliases to one worktree owner", () =>
    makeGitRepositoryRegistry(new LocalGitCommandRunner()).pipe(
      Effect.flatMap((registry) =>
        Effect.promise(async () => {
          const root = await mkdtemp(path.join(tmpdir(), "nodex-git-registry-"));
          temporaryDirectories.push(root);
          const nested = path.join(root, "nested", "directory");
          await mkdir(nested, { recursive: true });
          await execFileAsync("git", ["init", "-q", root]);

          const fromRoot = await registry.get(root);
          const fromNested = await registry.get(nested);

          expect(fromRoot).not.toBeNull();
          expect(fromNested).toBe(fromRoot);
          expect(fromRoot?.identity.root).toBe(await realpath(root));
        }),
      ),
    ),
  );

  it.effect("returns null for an ordinary directory", () =>
    makeGitRepositoryRegistry(new LocalGitCommandRunner()).pipe(
      Effect.flatMap((registry) =>
        Effect.promise(async () => {
          const root = await mkdtemp(path.join(tmpdir(), "nodex-not-git-"));
          temporaryDirectories.push(root);

          await expect(registry.get(root)).resolves.toBeNull();
        }),
      ),
    ),
  );
});
