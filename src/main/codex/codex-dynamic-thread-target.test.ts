import { describe, expect, test } from "vitest";
import type { CodexProjectlessWorkspace } from "./codex-projectless-workspace";
import {
  type CodexDynamicCreateProjectTarget,
  type CodexDynamicThreadTargetDependencies,
  resolveCodexDynamicCreateTarget,
} from "./codex-dynamic-thread-target";

function project(
  id: string,
  roots: readonly string[],
): CodexDynamicCreateProjectTarget {
  return {
    id,
    sources: roots.map((root) => ({ root })),
  };
}

function workspace(id: string): CodexProjectlessWorkspace {
  return {
    cwd: `/Documents/Codex/2026-07-11/${id}`,
    outputDirectory: `/Documents/Codex/2026-07-11/${id}/outputs`,
    workspaceRoot: "/Documents/Codex",
  };
}

function dependencies(input: {
  readonly projects?: readonly CodexDynamicCreateProjectTarget[];
  readonly workspaces?: readonly CodexProjectlessWorkspace[];
} = {}): CodexDynamicThreadTargetDependencies & {
  readonly workspaceInputs: Array<{
    readonly createSplitDirectories: true;
    readonly directoryName?: string;
    readonly prompt: string;
  }>;
} {
  const projects = input.projects ?? [];
  const workspaces = [...(input.workspaces ?? [workspace("generated")])];
  const workspaceInputs: Array<{
    readonly createSplitDirectories: true;
    readonly directoryName?: string;
    readonly prompt: string;
  }> = [];
  return {
    workspaceInputs,
    getProject(projectId) {
      return projects.find((candidate) => candidate.id === projectId) ?? null;
    },
    async createProjectlessWorkspace(factoryInput) {
      workspaceInputs.push(factoryInput);
      const next = workspaces.shift();
      if (!next) throw new Error("Missing test workspace");
      return next;
    },
  };
}

async function captureErrorMessage(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("Codex dynamic create-thread target resolution", () => {
  test("rejects an unknown project with the exact create_thread diagnostic", async () => {
    const deps = dependencies();
    expect(await captureErrorMessage(() => resolveCodexDynamicCreateTarget({
      prompt: "delegate",
      target: {
        type: "project",
        projectId: "missing",
        environment: { type: "local" },
      },
    }, deps))).toBe(
      "Unknown projectId: missing. Call list_projects to find available projects.",
    );
    expect(deps.workspaceInputs.length).toBe(0);
  });

  test("uses the only local project source directly without creating a workspace", async () => {
    const deps = dependencies({ projects: [project("one", ["/repo"])] });
    const resolved = await resolveCodexDynamicCreateTarget({
      prompt: "delegate",
      target: {
        type: "project",
        projectId: "one",
        environment: { type: "local" },
      },
    }, deps);

    expect(JSON.stringify(resolved)).toBe(JSON.stringify({
      launchMode: "direct",
      projectId: "one",
      cwd: "/repo",
      workspaceRoots: ["/repo"],
      workspaceKind: "project",
      projectlessOutputDirectory: null,
      projectlessWorkspaceBrowserRoot: null,
    }));
    expect(deps.workspaceInputs.length).toBe(0);
  });

  test("creates split workspaces for zero- and multi-source projects while retaining project kind", async () => {
    const deps = dependencies({
      projects: [
        project("empty", []),
        project("many", ["/repo/a", "/repo/b"]),
      ],
      workspaces: [workspace("empty-task"), workspace("many-task")],
    });
    const empty = await resolveCodexDynamicCreateTarget({
      prompt: "empty prompt",
      target: {
        type: "project",
        projectId: "empty",
        environment: { type: "local" },
      },
    }, deps);
    const many = await resolveCodexDynamicCreateTarget({
      prompt: "many prompt",
      target: {
        type: "project",
        projectId: "many",
        environment: { type: "local" },
      },
    }, deps);

    expect(JSON.stringify(empty)).toBe(JSON.stringify({
      launchMode: "direct",
      projectId: "empty",
      cwd: "/Documents/Codex/2026-07-11/empty-task",
      workspaceRoots: ["/Documents/Codex"],
      workspaceKind: "project",
      projectlessOutputDirectory: "/Documents/Codex/2026-07-11/empty-task/outputs",
      projectlessWorkspaceBrowserRoot: "/Documents/Codex",
    }));
    expect(JSON.stringify(many)).toBe(JSON.stringify({
      launchMode: "direct",
      projectId: "many",
      cwd: "/Documents/Codex/2026-07-11/many-task",
      workspaceRoots: ["/Documents/Codex", "/repo/a", "/repo/b"],
      workspaceKind: "project",
      projectlessOutputDirectory: "/Documents/Codex/2026-07-11/many-task/outputs",
      projectlessWorkspaceBrowserRoot: "/Documents/Codex",
    }));
    expect(JSON.stringify(deps.workspaceInputs)).toBe(JSON.stringify([
      { createSplitDirectories: true, prompt: "empty prompt" },
      { createSplitDirectories: true, prompt: "many prompt" },
    ]));
  });

  test("creates a fresh split projectless workspace and returns its output and browser roots", async () => {
    const deps = dependencies({
      workspaces: [workspace("first"), workspace("second")],
    });
    const target = {
      type: "projectless" as const,
      directoryName: "Deliverables",
    };
    const first = await resolveCodexDynamicCreateTarget({
      prompt: "first prompt",
      target,
    }, deps);
    const second = await resolveCodexDynamicCreateTarget({
      prompt: "second prompt",
      target,
    }, deps);

    expect(JSON.stringify(first)).toBe(JSON.stringify({
      launchMode: "direct",
      projectId: null,
      cwd: "/Documents/Codex/2026-07-11/first",
      workspaceRoots: ["/Documents/Codex"],
      workspaceKind: "projectless",
      projectlessOutputDirectory: "/Documents/Codex/2026-07-11/first/outputs",
      projectlessWorkspaceBrowserRoot: "/Documents/Codex",
    }));
    expect(JSON.stringify(second)).toBe(JSON.stringify({
      launchMode: "direct",
      projectId: null,
      cwd: "/Documents/Codex/2026-07-11/second",
      workspaceRoots: ["/Documents/Codex"],
      workspaceKind: "projectless",
      projectlessOutputDirectory: "/Documents/Codex/2026-07-11/second/outputs",
      projectlessWorkspaceBrowserRoot: "/Documents/Codex",
    }));
    expect(JSON.stringify(deps.workspaceInputs)).toBe(JSON.stringify([
      {
        createSplitDirectories: true,
        prompt: "first prompt",
        directoryName: "Deliverables",
      },
      {
        createSplitDirectories: true,
        prompt: "second prompt",
        directoryName: "Deliverables",
      },
    ]));
  });

  test("requires exactly one worktree source and passes the selected starting state through", async () => {
    const selectedStartingState = {
      type: "branch" as const,
      branchName: "feature/exact",
    };
    const deps = dependencies({
      projects: [
        project("one", ["/repo"]),
        project("empty", []),
        project("many", ["/repo/a", "/repo/b"]),
      ],
    });
    const resolved = await resolveCodexDynamicCreateTarget({
      prompt: "delegate",
      target: {
        type: "project",
        projectId: "one",
        environment: {
          type: "worktree",
          startingState: selectedStartingState,
        },
      },
    }, deps);

    expect(JSON.stringify(resolved)).toBe(JSON.stringify({
      launchMode: "worktree",
      projectId: "one",
      cwd: "/repo",
      workspaceRoots: ["/repo"],
      workspaceKind: "project",
      projectlessOutputDirectory: null,
      projectlessWorkspaceBrowserRoot: null,
      startingState: selectedStartingState,
    }));
    expect(resolved.launchMode === "worktree" && resolved.startingState).toBe(selectedStartingState);
    expect(await captureErrorMessage(() => resolveCodexDynamicCreateTarget({
      prompt: "empty",
      target: {
        type: "project",
        projectId: "empty",
        environment: { type: "worktree" },
      },
    }, deps))).toBe("Worktree threads require a project with exactly one directory");
    expect(await captureErrorMessage(() => resolveCodexDynamicCreateTarget({
      prompt: "many",
      target: {
        type: "project",
        projectId: "many",
        environment: { type: "worktree" },
      },
    }, deps))).toBe("Worktree threads require a project with exactly one directory");
    expect(deps.workspaceInputs.length).toBe(0);
  });
});
