import { describe, expect, test } from "bun:test";
import { render } from "@/test/dom";
import type { BoardSummary, CardSummary, Project } from "@/lib/types";
import type { SendBlocksMode } from "./nfm-drag-handle-menu";
import { SendBlocksDialogSurface } from "./send-blocks-dialog";

const TEST_DATE = new Date("2026-01-01T00:00:00.000Z");

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    description: "",
    icon: undefined,
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: TEST_DATE,
    updated: TEST_DATE,
  };
}

function makeCard(id: string, title: string, status: CardSummary["status"], order: number): CardSummary {
  return {
    id,
    status,
    archived: false,
    title,
    tags: [],
    agentBlocked: false,
    created: TEST_DATE,
    order,
    revision: 1,
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
  };
}

const BOARD: BoardSummary = {
  columns: [
    {
      id: "draft",
      name: "Draft",
      cards: [
        makeCard("source-card", "Source", "draft", 0),
        makeCard("target-card", "Target", "draft", 1),
      ],
    },
  ],
};

function renderMoveDialog(mode: SendBlocksMode) {
  return render(
    <SendBlocksDialogSurface
      open={true}
      mode={mode}
      blockCount={2}
      sourceProjectId="default"
      sourceCardId="source-card"
      projects={[makeProject("default", "Default")]}
      projectsLoading={false}
      boardMap={new Map([["default", BOARD]])}
      boardsLoading={false}
      loadError={null}
      onOpenChange={() => undefined}
      onAppendToCard={async () => undefined}
      onSendToProject={async () => undefined}
    />,
  );
}

describe("send blocks dialog", () => {
  test("names the card move dialog after the Move to card action", () => {
    const view = renderMoveDialog("card");

    expect(view.getByRole("dialog", { name: "Move to card" })).not.toBeNull();
  });

  test("names the project move dialog after the Move to DB action", () => {
    const view = renderMoveDialog("project");

    expect(view.getByRole("dialog", { name: "Move to DB" })).not.toBeNull();
  });
});
