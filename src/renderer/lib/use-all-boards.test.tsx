import { beforeEach, describe, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { render, settleAsyncRender } from "@/test/dom";
import { createTestQueryClient, TestQueryProvider } from "@/test/query";
import { installWindowApi } from "@/test/browser-globals";
import type { BoardSummary, Project } from "./types";
import { useAllBoards, useBoardsForProjects } from "./use-all-boards";

let invokeCalls: unknown[][] = [];

const PROJECTS: Project[] = [
  {
    id: "project-1",
    name: "Project",
    description: "",
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-06-24T00:00:00.000Z"),
    updated: new Date("2026-06-24T00:00:00.000Z"),
  },
];

const BOARD: BoardSummary = {
  columns: [
    {
      id: "in_progress",
      name: "Doing",
      cards: [],
    },
  ],
};

function makeProject(id: string): Project {
  return {
    id,
    name: id,
    description: "",
    sources: [{ root: `/tmp/${id}`, order: 0 }],
    primaryWorkspaceRoot: `/tmp/${id}`,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-01-01T00:00:00.000Z"),
    updated: new Date("2026-01-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  invokeCalls = [];
  installWindowApi({
    invoke: async (channel: string, ...args: unknown[]) => {
      invokeCalls.push([channel, ...args]);
      if (channel === "board:summary:get") {
        return BOARD;
      }
      throw new Error(`Unexpected channel: ${channel}`);
    },
    on: () => () => undefined,
  });
});

function AllBoardsHarness() {
  const { boards, loading } = useAllBoards();
  return <span data-testid="boards-state">{loading ? "loading" : "ready"}:{boards.size}</span>;
}

function BoardsHarness({
  snapshots,
}: {
  snapshots: Array<ReturnType<typeof useBoardsForProjects>>;
}) {
  const result = useBoardsForProjects(PROJECTS);
  snapshots.push(result);

  return <div>{result.loading ? "loading" : String(result.boards.size)}</div>;
}

describe("useAllBoards", () => {
  test("loads project boards in parallel and keeps successful boards when one fails", async () => {
    const board: BoardSummary = { columns: [] };
    installWindowApi({
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === "projects:list") return [makeProject("alpha"), makeProject("beta")];
        if (channel === "board:summary:get") {
          if (args[0] === "beta") throw new Error("board unavailable");
          return board;
        }
        throw new Error(`Unexpected channel: ${channel}`);
      },
      on: () => () => undefined,
    });

    const view = render(
      <TestQueryProvider>
        <AllBoardsHarness />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByTestId("boards-state").textContent).toBe("ready:1");
    });
  });
});

describe("useBoardsForProjects", () => {
  test("keeps the combined board Map stable across ordinary rerenders", async () => {
    const snapshots: Array<ReturnType<typeof useBoardsForProjects>> = [];
    const client = createTestQueryClient();
    const view = render(
      <TestQueryProvider client={client}>
        <BoardsHarness snapshots={snapshots} />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      if (view.getByText("1").textContent !== "1") {
        throw new Error("Expected board summary query to load.");
      }
    });

    const firstLoadedResult = snapshots.at(-1);
    expect(firstLoadedResult !== undefined).toBeTrue();
    if (!firstLoadedResult) return;

    view.rerender(
      <TestQueryProvider client={client}>
        <BoardsHarness snapshots={snapshots} />
      </TestQueryProvider>,
    );
    await settleAsyncRender();

    const secondLoadedResult = snapshots.at(-1);
    expect(secondLoadedResult !== undefined).toBeTrue();
    if (!secondLoadedResult) return;
    expect(firstLoadedResult.boards).toBe(secondLoadedResult.boards);
    expect(invokeCalls.length).toBe(1);
  });
});
