import { describe, expect, test } from "vite-plus/test";
import type { Project } from "../../shared/types";
import { DEFAULT_PROJECT_APPEARANCE } from "../../shared/project-appearance";
import {
  appendMissingCodexProjectMoveSources,
  listMissingCodexProjectMoveSources,
  resolveCodexProjectThreadWorkspaceMove,
  resolveCodexProjectlessThreadWorkspaceMove,
} from "./codex-sidebar-thread-move";

function makeProject(id: string, roots: string[]): Project {
  return {
    id,
    libraryId: "library:test",
    databaseId: `database:${id}:primary`,
    defaultDatabaseViewId: `view:${id}:primary`,
    lifecycle: "active",
    bindingRevision: 1,
    name: id,
    description: "",
    appearance: DEFAULT_PROJECT_APPEARANCE,
    sources: roots.map((root, order) => ({ root, order })),
    primaryWorkspaceRoot: roots[0] ?? null,
    pinned: false,
    pinnedOrder: null,
    created: new Date(0),
    updated: new Date(0),
  };
}

const current = {
  cwd: "/repo/source",
  managedWorktreePath: null,
  projectlessOutputDirectory: null,
  projectlessWorkspaceBrowserRoot: null,
};

describe("Codex sidebar project thread workspace move", () => {
  test("blocks only source roots absent from a different destination", () => {
    const source = makeProject("source", ["/repo/source", "/repo/shared"]);
    const target = makeProject("target", ["/repo/shared"]);
    expect(JSON.stringify(listMissingCodexProjectMoveSources(source, target))).toBe(
      JSON.stringify(["/repo/source"]),
    );
    expect(listMissingCodexProjectMoveSources(source, source).length).toBe(0);
    expect(listMissingCodexProjectMoveSources(null, target).length).toBe(0);
    expect(JSON.stringify(listMissingCodexProjectMoveSources(source, null))).toBe(
      JSON.stringify(["/repo/source", "/repo/shared"]),
    );
  });

  test("treats a target ancestor as access to nested source roots without prefix leaks", () => {
    const source = makeProject("source", ["/repo/nodex", "/repo-a", "/repo/other/../shared"]);
    const target = makeProject("target", ["/repo"]);

    expect(listMissingCodexProjectMoveSources(source, target)).toEqual(["/repo-a"]);
    expect(
      listMissingCodexProjectMoveSources(
        makeProject("source", ["/repo"]),
        makeProject("target", ["/repo/nodex"]),
      ),
    ).toEqual(["/repo"]);
  });

  test("appends missing roots once and promotes the first root to primary", () => {
    const target = makeProject("target", []);
    const expanded = appendMissingCodexProjectMoveSources(target, [
      "/repo/source",
      "/repo/source/../source",
      "/repo/shared",
    ]);

    expect(expanded.sources).toEqual([
      { root: "/repo/source", order: 0 },
      { root: "/repo/shared", order: 1 },
    ]);
    expect(expanded.primaryWorkspaceRoot).toBe("/repo/source");
  });

  test("uses the sole project source without generating a workspace", async () => {
    let generated = false;
    const move = await resolveCodexProjectThreadWorkspaceMove({
      current,
      targetProject: makeProject("target", ["/repo/target"]),
      threadTitle: "Move me",
      createProjectlessWorkspace: async () => {
        generated = true;
        throw new Error("unexpected workspace generation");
      },
    });
    expect(generated).toBe(false);
    expect(move.next.cwd).toBe("/repo/target");
    expect(JSON.stringify(move.runtimeWorkspaceRoots)).toBe(JSON.stringify(["/repo/target"]));
  });

  test("generates a workspace for zero or multiple project sources", async () => {
    const prompts: string[] = [];
    const move = await resolveCodexProjectThreadWorkspaceMove({
      current,
      targetProject: makeProject("target", ["/repo/a", "/repo/b"]),
      threadTitle: "Move me",
      createProjectlessWorkspace: async (input) => {
        prompts.push(input.prompt);
        return {
          cwd: "/generated/work",
          outputDirectory: "/generated/outputs",
          workspaceRoot: "/generated",
        };
      },
    });
    expect(prompts[0]).toBe("Move me");
    expect(move.next.cwd).toBe("/generated/work");
    expect(move.next.projectlessOutputDirectory).toBe("/generated/outputs");
    expect(JSON.stringify(move.runtimeWorkspaceRoots)).toBe(
      JSON.stringify(["/generated", "/repo/a", "/repo/b"]),
    );
  });

  test("retains an existing worktree cwd and keeps projectless state unchanged", async () => {
    const worktree = await resolveCodexProjectThreadWorkspaceMove({
      current: {
        ...current,
        cwd: "/repo/.worktrees/thread/workspace",
        managedWorktreePath: "/repo/.worktrees/thread",
      },
      targetProject: makeProject("target", ["/repo/source"]),
      threadTitle: "Move me",
      createProjectlessWorkspace: async () => {
        throw new Error("unexpected workspace generation");
      },
    });
    expect(worktree.next.cwd).toBe("/repo/.worktrees/thread/workspace");
    expect(JSON.stringify(worktree.runtimeWorkspaceRoots)).toBe(
      JSON.stringify(["/repo/.worktrees/thread/workspace", "/repo/source"]),
    );

    const projectless = resolveCodexProjectlessThreadWorkspaceMove({
      current,
      persistedRuntimeWorkspaceRoots: ["/repo/source"],
    });
    expect(projectless.next.cwd).toBe(current.cwd);
    expect(JSON.stringify(projectless.runtimeWorkspaceRoots)).toBe(
      JSON.stringify(["/repo/source"]),
    );
  });
});
