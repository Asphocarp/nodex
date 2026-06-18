import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "bun:test";
import { render } from "@/test/dom";
import { installWindowApi } from "@/test/browser-globals";
import { TestQueryProvider } from "@/test/query";
import type { BoardSummary, Project } from "./types";
import { useAllBoards } from "./use-all-boards";

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

function BoardsHarness() {
  const { boards, loading } = useAllBoards();
  return <span data-testid="boards-state">{loading ? "loading" : "ready"}:{boards.size}</span>;
}

describe("useAllBoards", () => {
  beforeEach(() => {
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
      on: () => () => {},
    });
  });

  test("loads project boards in parallel and keeps successful boards when one fails", async () => {
    const view = render(
      <TestQueryProvider>
        <BoardsHarness />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByTestId("boards-state").textContent).toBe("ready:1");
    });
  });
});
