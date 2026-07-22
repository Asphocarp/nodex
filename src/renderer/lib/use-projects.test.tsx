import { act, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { useState } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import { installWindowApi } from "@/test/browser-globals";
import { TestQueryProvider } from "@/test/query";
import type { Project } from "./types";
import { useProjects } from "./use-projects";

function makeProject(id: string, name = id): Project {
  return {
    id,
    libraryId: "library:test",
    databaseId: "database:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name,
    description: "",
    sources: [{ root: `/tmp/${id}`, order: 0 }],
    primaryWorkspaceRoot: `/tmp/${id}`,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-01-01T00:00:00.000Z"),
    updated: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function ProjectsHarness() {
  const first = useProjects();
  const second = useProjects();
  const [archiveResult, setArchiveResult] = useState("");

  return (
    <div>
      <span data-testid="project-count">{first.projects.length}:{second.projects.length}</span>
      <span data-testid="projects-ready">{String(first.ready)}</span>
      <span data-testid="projects-error">{first.error ?? ""}</span>
      <span data-testid="archive-result">{archiveResult}</span>
      <button
        type="button"
        onClick={() => {
          void first.reorderProjects({
            orderedProjectIds: first.projects.map((project) => project.id).reverse(),
          });
        }}
      >
        Reverse projects
      </button>
      <button type="button" onClick={() => void first.refresh()}>
        Retry projects
      </button>
      <button
        type="button"
        onClick={() => {
          const projectId = first.projects[0]?.id;
          if (!projectId) return;
          void first.archiveProject(projectId).then((result) => setArchiveResult(result.kind));
        }}
      >
        Remove first project
      </button>
    </div>
  );
}

describe("useProjects", () => {
  let projects: Project[];
  let listCalls = 0;
  let projectChangeListener: ((event: unknown) => void) | null = null;

  beforeEach(() => {
    projects = [makeProject("alpha"), makeProject("beta")];
    listCalls = 0;
    projectChangeListener = null;

    installWindowApi({
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === "projects:list") {
          listCalls += 1;
          return projects;
        }

        if (channel === "projects:reorder") {
          const input = args[0] as { orderedProjectIds: string[] };
          projects = input.orderedProjectIds
            .map((projectId) => projects.find((project) => project.id === projectId))
            .filter((project): project is Project => Boolean(project));
          return projects;
        }

        if (channel === "projects:set-lifecycle") {
          const projectId = args[0] as string;
          const project = projects.find((candidate) => candidate.id === projectId);
          if (!project) return { kind: "not-found" };
          projects = projects.filter((candidate) => candidate.id !== projectId);
          return {
            kind: "updated",
            changed: true,
            project: { ...project, lifecycle: "archived" },
          };
        }

        throw new Error(`Unexpected channel: ${channel}`);
      },
      on: (channel: string, listener: (event: unknown) => void) => {
        if (channel === "projects-changed") {
          projectChangeListener = listener;
        }
        return () => {
          if (projectChangeListener === listener) projectChangeListener = null;
        };
      },
    });
  });

  test("dedupes list requests across consumers and refetches after project changes", async () => {
    const view = render(
      <TestQueryProvider>
        <ProjectsHarness />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByTestId("project-count").textContent).toBe("2:2");
    });
    expect(listCalls).toBe(1);

    projects = [...projects, makeProject("gamma")];
    await act(async () => {
      projectChangeListener?.({});
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.getByTestId("project-count").textContent).toBe("3:3");
    });
    expect(listCalls).toBe(2);
  });

  test("updates the list cache after reorder without an extra list request", async () => {
    const view = render(
      <TestQueryProvider>
        <ProjectsHarness />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByTestId("project-count").textContent).toBe("2:2");
    });
    expect(listCalls).toBe(1);

    fireEvent.click(view.getByRole("button", { name: "Reverse projects" }));
    await settleAsyncRender();

    expect(projects[0]?.id).toBe("beta");
    expect(listCalls).toBe(1);
  });

  test("archives through the typed lifecycle mutation and invalidates the active catalog", async () => {
    const view = render(
      <TestQueryProvider>
        <ProjectsHarness />
      </TestQueryProvider>,
    );
    await waitFor(() => {
      expect(view.getByTestId("project-count").textContent).toBe("2:2");
    });

    fireEvent.click(view.getByRole("button", { name: "Remove first project" }));

    await waitFor(() => {
      expect(view.getByTestId("archive-result").textContent).toBe("updated");
      expect(view.getByTestId("project-count").textContent).toBe("1:1");
    });
    expect(listCalls).toBe(2);
  });

  test("stays unready after an initial error and becomes ready after retry", async () => {
    let attempts = 0;
    installWindowApi({
      invoke: async (channel: string) => {
        if (channel !== "projects:list") throw new Error(`Unexpected channel: ${channel}`);
        attempts += 1;
        if (attempts === 1) throw new Error("Project catalog unavailable");
        return projects;
      },
      on: () => () => undefined,
    });
    const view = render(
      <TestQueryProvider>
        <ProjectsHarness />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByTestId("projects-ready").textContent).toBe("false");
      expect(view.getByTestId("projects-error").textContent).toBe("Project catalog unavailable");
    });

    fireEvent.click(view.getByRole("button", { name: "Retry projects" }));

    await waitFor(() => {
      expect(view.getByTestId("projects-ready").textContent).toBe("true");
      expect(view.getByTestId("project-count").textContent).toBe("2:2");
    });
    expect(attempts).toBe(2);
  });
});
