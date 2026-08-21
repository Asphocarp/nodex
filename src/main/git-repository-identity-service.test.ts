import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { readGitRepositoryIdentity } from "./git-repository-identity-service";

const execFileAsync = promisify(execFile);
const fixtureRoots: string[] = [];

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nodex-git-identity-"));
  fixtureRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("readGitRepositoryIdentity", () => {
  it("returns the top-level repository and preferred origin from a nested source", async () => {
    const root = await createFixture();
    const nested = join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["remote", "add", "origin", "git@github.com:acme/nodex.git"], {
      cwd: root,
    });

    await expect(readGitRepositoryIdentity(nested)).resolves.toEqual({
      repositoryRoot: await realpath(root),
      ownerRepo: { owner: "acme", repo: "nodex" },
    });
  });

  it("uses the first configured remote when origin is absent", async () => {
    const root = await createFixture();
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync(
      "git",
      ["remote", "add", "upstream", "https://example.com/acme/nodex.git"],
      { cwd: root },
    );

    await expect(readGitRepositoryIdentity(root)).resolves.toEqual({
      repositoryRoot: await realpath(root),
      ownerRepo: { owner: "acme", repo: "nodex" },
    });
  });

  it("never exposes credentials embedded in a remote URL", async () => {
    const root = await createFixture();
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync(
      "git",
      ["remote", "add", "origin", "https://user:secret@example.com/acme/private.git?token=hidden"],
      { cwd: root },
    );

    const identity = await readGitRepositoryIdentity(root);
    expect(identity).toEqual({
      repositoryRoot: await realpath(root),
      ownerRepo: { owner: "acme", repo: "private" },
    });
    expect(JSON.stringify(identity)).not.toContain("secret");
    expect(JSON.stringify(identity)).not.toContain("hidden");
  });

  it("keeps repositories without remotes and omits non-repositories", async () => {
    const repository = await createFixture();
    const ordinaryDirectory = await createFixture();
    await execFileAsync("git", ["init"], { cwd: repository });

    await expect(readGitRepositoryIdentity(repository)).resolves.toEqual({
      repositoryRoot: await realpath(repository),
      ownerRepo: null,
    });
    await expect(readGitRepositoryIdentity(ordinaryDirectory)).resolves.toBeNull();
  });
});
