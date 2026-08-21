import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  cleanupDevelopmentEnvironmentHome,
  markDevelopmentEnvironmentInitialized,
  openDevelopmentEnvironmentHome,
  refreshDevelopmentEnvironmentHome,
  resolveDevelopmentHomeRoot,
  updateDevelopmentAgentFiles,
} from "./development-environment-home";

const roots: string[] = [];

const createRepository = async (): Promise<string> => {
  const root = await mkdtemp("/tmp/ndh-");
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("development environment home", () => {
  test("resolves the default and explicit environment roots from the repository", async () => {
    const repositoryRoot = await createRepository();
    expect(resolveDevelopmentHomeRoot(repositoryRoot)).toBe(
      path.join(repositoryRoot, "runs.local/default"),
    );
    expect(resolveDevelopmentHomeRoot(repositoryRoot, "runs.local/perf")).toBe(
      path.join(repositoryRoot, "runs.local/perf"),
    );
  });

  test("creates the owned layout and reopens the same identity", async () => {
    const repositoryRoot = await createRepository();
    const created = await openDevelopmentEnvironmentHome({ repositoryRoot });
    expect(created.wasCreated).toBe(true);
    await expect(
      Promise.all([
        stat(created.nodexHome),
        stat(created.codexHome),
        stat(created.workspace),
        stat(created.artifacts),
      ]),
    ).resolves.toHaveLength(4);

    const reopened = await openDevelopmentEnvironmentHome({ repositoryRoot });
    expect(reopened.wasCreated).toBe(false);
    expect(reopened.manifest.environmentId).toBe(created.manifest.environmentId);
  });

  test("records initialization and seed provenance atomically", async () => {
    const repositoryRoot = await createRepository();
    const home = await openDevelopmentEnvironmentHome({ repositoryRoot });
    await markDevelopmentEnvironmentInitialized(home, {
      id: "board/dense",
      revision: 2,
    });
    const refreshed = await refreshDevelopmentEnvironmentHome(home);
    expect(refreshed.manifest).toMatchObject({
      initializedAt: expect.any(String),
      seed: { id: "board/dense", revision: 2 },
    });
  });

  test("copies explicit agent files privately and sanitizes config", async () => {
    const repositoryRoot = await createRepository();
    const home = await openDevelopmentEnvironmentHome({ repositoryRoot });
    const auth = path.join(repositoryRoot, "source-auth.json");
    const config = path.join(repositoryRoot, "source-config.toml");
    await writeFile(auth, '{"token":"test"}\n');
    await writeFile(
      config,
      ['model = "gpt-5"', "[mcp_servers.node_repl]", 'command = "node"', ""].join("\n"),
    );

    await updateDevelopmentAgentFiles(home, {
      authJson: auth,
      agentConfigToml: config,
    });

    const installedAuth = path.join(home.codexHome, "auth.json");
    const installedConfig = path.join(home.codexHome, "config.toml");
    expect((await stat(installedAuth)).mode & 0o777).toBe(0o600);
    expect((await stat(installedConfig)).mode & 0o777).toBe(0o600);
    expect(await readFile(installedAuth, "utf8")).toContain("test");
    expect(await readFile(installedConfig, "utf8")).not.toContain("node_repl");
  });

  test("deletes only the owned home without runtime evidence", async () => {
    const repositoryRoot = await createRepository();
    const home = await openDevelopmentEnvironmentHome({ repositoryRoot });
    await expect(cleanupDevelopmentEnvironmentHome(home)).resolves.toEqual({
      status: "deleted",
    });

    const unsafe = await openDevelopmentEnvironmentHome({
      repositoryRoot,
      home: "runs.local/unsafe",
    });
    const runtimeDirectory = path.join(unsafe.nodexHome, "run/core");
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(path.join(runtimeDirectory, "core.json"), "{}");
    await expect(cleanupDevelopmentEnvironmentHome(unsafe)).resolves.toMatchObject({
      status: "unsafe",
    });
    await expect(stat(unsafe.root)).resolves.toBeDefined();
  });
});
