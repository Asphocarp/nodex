import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import type { Project } from "@/lib/types";
import { installWindowApi } from "@/test/browser-globals";
import { render } from "@/test/dom";
import { TestQueryProvider } from "@/test/query";
import { RemovedProjectsDialog } from "./removed-projects-dialog";

function makeRemovedProject(): Project {
  return {
    id: "project-removed",
    libraryId: "library-test",
    databaseId: "database-removed",
    lifecycle: "archived",
    bindingRevision: 3,
    name: "Removed Alpha",
    description: "",
    sources: [{ root: "/repo/removed-alpha", order: 0 }],
    primaryWorkspaceRoot: "/repo/removed-alpha",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-01-01T00:00:00.000Z"),
    updated: new Date("2026-07-22T00:00:00.000Z"),
  };
}

describe("RemovedProjectsDialog", () => {
  let projects: Project[];
  let listCalls: unknown[][];

  beforeEach(() => {
    projects = [makeRemovedProject()];
    listCalls = [];
    installWindowApi({
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === "projects:list") {
          listCalls.push(args);
          return projects;
        }
        if (channel === "projects:set-lifecycle") {
          const project = projects.find((candidate) => candidate.id === args[0]);
          if (!project) return { kind: "not-found" };
          projects = [];
          return {
            kind: "updated",
            changed: true,
            project: { ...project, lifecycle: "active" },
          };
        }
        throw new Error(`Unexpected channel: ${channel}`);
      },
      on: () => () => undefined,
    });
  });

  test("loads removed projects only when opened and restores one row in place", async () => {
    const closed = render(
      <TestQueryProvider>
        <RemovedProjectsDialog open={false} onOpenChange={() => undefined} />
      </TestQueryProvider>,
    );
    expect(listCalls).toEqual([]);
    closed.unmount();

    const view = render(
      <TestQueryProvider>
        <RemovedProjectsDialog open onOpenChange={() => undefined} />
      </TestQueryProvider>,
    );
    expect(await view.findByText("Removed Alpha")).toBeTruthy();
    expect(view.getByText("/repo/removed-alpha")).toBeTruthy();
    expect(listCalls).toEqual([[{ includeArchived: true }]]);

    fireEvent.click(view.getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(view.getByText("No removed projects")).toBeTruthy();
    });
  });
});
