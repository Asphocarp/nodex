import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import type { BoardSummary, CardSummary, Project } from "@/lib/types";
import {
  TEXT_ACTION_RECENT_COLOR_STORAGE_KEY,
  writeTextActionRecentColors,
} from "@/lib/text-action-color-recents";
import { render, settleAsyncRender } from "@/test/dom";
import { NfmMoveToMenuSurface } from "./nfm-move-to-menu";
import type { NfmMoveToDestination } from "./nfm-move-to-menu-model";
import { NFM_SEND_TO_THREAD_MODE_STORAGE_KEY } from "./nfm-send-to-thread-mode-settings";
import { NfmSendToThreadMenuSurface, type NfmSendToThreadMenuSurfaceProps } from "./nfm-send-to-thread-menu";
import type { NfmSendToThreadRequest } from "./nfm-send-to-thread-menu-model";
import { NfmTextActionMenuSurface, type NfmTextActionMenuSurfaceProps } from "./nfm-text-action-menu";

const TEST_DATE = new Date("2026-01-01T00:00:00.000Z");

function makeProject(id: string, name: string, icon?: string): Project {
  return {
    id,
    name,
    description: "",
    icon,
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

const MOVE_TO_PROJECTS = [
  makeProject("default", "Default", "🔥"),
  makeProject("renderer", "Renderer parity", "🧭"),
];

const MOVE_TO_BOARD_MAP = new Map<string, BoardSummary>([
  [
    "default",
    {
      columns: [
        {
          id: "draft",
          name: "Draft",
          cards: [
            makeCard("source-card", "Source card", "draft", 0),
            makeCard("target-card", "Target card", "draft", 1),
          ],
        },
      ],
    },
  ],
  [
    "renderer",
    {
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          cards: [makeCard("runtime", "Runtime polish", "backlog", 0)],
        },
      ],
    },
  ],
]);

const SEND_TO_THREAD_THREADS = [
  {
    threadId: "thread-existing",
    projectId: "default",
    cardId: "source-card",
    source: null,
    threadName: "Existing implementation",
    threadPreview: "Continue from selected notes",
    modelProvider: "openai",
    cwd: "/repo",
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-01-01T00:00:00.000Z",
  },
] satisfies NfmSendToThreadMenuSurfaceProps["threads"];

function renderTextActionMenu(
  props?: Partial<NfmTextActionMenuSurfaceProps>,
) {
  const actions = {
    blockTypes: [] as string[],
    styles: [] as string[],
    textColors: [] as string[],
    backgroundColors: [] as string[],
    clearFormat: 0,
    blockActions: 0,
    nodexRows: [] as string[],
    moveDestinations: [] as NfmMoveToDestination[],
    sendRequests: [] as NfmSendToThreadRequest[],
  };

  const view = render(
    <NodexTooltipProvider>
      <NfmTextActionMenuSurface
        currentBlockTypeLabel="Normal Text"
        blockTypeItems={[
          {
            key: "paragraph",
            label: "Normal Text",
            type: "paragraph",
            isSelected: true,
          },
          {
            key: "heading-1",
            label: "Heading 1",
            type: "heading",
            props: { level: 1, isToggleable: false },
            isSelected: false,
          },
        ]}
        activeStyles={{
          bold: true,
          italic: false,
          underline: false,
          strike: false,
          code: false,
        }}
        textColor="default"
        backgroundColor="default"
        canUseTextColor={true}
        canUseBackgroundColor={true}
        canClearFormat={true}
        linkControl={<button type="button" aria-label="Link">Link</button>}
        nodexRows={[
          {
            key: "send-to-thread",
            label: "Send to chat",
            enabled: true,
          },
          {
            key: "move-to",
            label: "Move to",
            enabled: true,
          },
        ]}
        sourceProjectId="default"
        sourceCardId="source-card"
        onSelectBlockType={(item) => {
          actions.blockTypes.push(item.key);
        }}
        onToggleStyle={(style) => {
          actions.styles.push(style);
        }}
        onSetTextColor={(color) => {
          actions.textColors.push(color);
        }}
        onSetBackgroundColor={(color) => {
          actions.backgroundColors.push(color);
        }}
        onClearFormat={() => {
          actions.clearFormat += 1;
        }}
        onOpenBlockActions={() => {
          actions.blockActions += 1;
        }}
        onNodexRow={(row) => {
          actions.nodexRows.push(row.key);
        }}
        onMoveBlocksToDestination={(destination) => {
          actions.moveDestinations.push(destination);
        }}
        onSendBlocksToThread={(request) => {
          actions.sendRequests.push(request);
        }}
        {...props}
      />
    </NodexTooltipProvider>,
  );

  return { actions, view };
}

describe("nfm text action menu surface", () => {
  beforeEach(() => {
    localStorage.removeItem(TEXT_ACTION_RECENT_COLOR_STORAGE_KEY);
    localStorage.removeItem(NFM_SEND_TO_THREAD_MODE_STORAGE_KEY);
  });

  async function openColorMenu(view: ReturnType<typeof renderTextActionMenu>["view"]) {
    await act(async () => {
      fireEvent.pointerDown(view.getByRole("button", { name: "Color" }), {
        button: 0,
        ctrlKey: false,
      });
      await settleAsyncRender();
    });
  }

  test("renders the fixture-level action hierarchy with inactive reference mocks", () => {
    const { view } = renderTextActionMenu();

    expect(view.getByRole("toolbar", { name: "Text actions" }).getAttribute("aria-label")).toBe("Text actions");
    expect(view.getByRole("button", { name: "Normal Text" }).getAttribute("aria-haspopup")).toBe("dialog");
    expect(view.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    expect(view.getByRole("button", { name: "Color" }).getAttribute("aria-haspopup")).toBe("dialog");
    expect(view.getByRole("button", { name: "Equation" }).getAttribute("aria-disabled")).toBe("true");
    expect(view.getByRole("button", { name: "Write a comment" }).getAttribute("aria-disabled")).toBe("true");
    expect(view.getByRole("textbox").getAttribute("aria-disabled")).toBe("true");
    expect(Boolean(view.getByText("Improve writing"))).toBeTrue();
    expect(Boolean(view.getByText("⌘⌃E"))).toBeTrue();

    const toolbarText = view.getByRole("toolbar", { name: "Text actions" }).textContent ?? "";
    const nodexIndex = toolbarText.indexOf("Actions");
    const skillsIndex = toolbarText.indexOf("Skills");
    expect(nodexIndex >= 0 && skillsIndex >= 0 && nodexIndex < skillsIndex).toBeTrue();
  });

  test("opens the block type menu and delegates Turn into selections", async () => {
    const { actions, view } = renderTextActionMenu();

    await act(async () => {
      fireEvent.pointerDown(view.getByRole("button", { name: "Normal Text" }), {
        button: 0,
        ctrlKey: false,
      });
      await settleAsyncRender();
    });

    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Heading 1" }));
      await settleAsyncRender();
    });

    expect(actions.blockTypes.join(",")).toBe("heading-1");
  });

  test("invokes supported annotation and Nodex actions", async () => {
    const { actions, view } = renderTextActionMenu();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Bold" }));
      fireEvent.click(view.getByRole("button", { name: "Clear format" }));
      await settleAsyncRender();
    });

    expect(actions.styles.join(",")).toBe("bold");
    expect(actions.clearFormat).toBe(1);
    expect(actions.nodexRows.join(",")).toBe("");
  });

  test("opens the send-to-chat picker and submits thread and new-thread targets", async () => {
    const { actions, view } = renderTextActionMenu({
      renderSendToThreadMenu: (props) => (
        <NfmSendToThreadMenuSurface
          {...props}
          threads={SEND_TO_THREAD_THREADS}
        />
      ),
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Send to chat" }));
      await settleAsyncRender();
    });

    expect(Boolean(view.getByRole("dialog", { name: "Send to chat" }))).toBeTrue();
    expect(Boolean(view.getByRole("combobox", { name: "Search threads" }))).toBeTrue();
    expect(view.getByRole("button", { name: "Send" }).getAttribute("aria-pressed")).toBe("true");
    expect(view.getByRole("button", { name: "Send & wrap" }).getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      fireEvent.pointerMove(view.getByRole("button", { name: "Send & wrap" }));
      await settleAsyncRender();
    });
    expect(view.queryAllByText("Sends the blocks, then replaces them with a collapsed toggle linking to the thread.").length).toBe(0);

    await act(async () => {
      fireEvent.pointerMove(view.getByTestId("send-to-thread-wrap-mode-info"));
      await settleAsyncRender();
    });
    expect(view.getAllByText("Sends the blocks, then replaces them with a collapsed toggle linking to the thread.").length > 0).toBeTrue();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Send & wrap" }));
      await settleAsyncRender();
    });
    expect(localStorage.getItem(NFM_SEND_TO_THREAD_MODE_STORAGE_KEY)).toBe("wrap-toggle");

    await act(async () => {
      fireEvent.click(view.getByRole("option", { name: /Existing implementation/ }));
      await settleAsyncRender();
    });

    await waitFor(() => {
      expect(actions.sendRequests.length).toBe(1);
    });
    expect(actions.sendRequests[0]?.mode).toBe("wrap-toggle");
    expect(actions.sendRequests[0]?.target.kind).toBe("thread");
    if (actions.sendRequests[0]?.target.kind !== "thread") {
      throw new Error("expected thread target");
    }
    expect(actions.sendRequests[0].target.threadId).toBe("thread-existing");

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Send to chat" }));
      await settleAsyncRender();
    });

    expect(view.getByRole("button", { name: "Send & wrap" }).getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Send" }));
      await settleAsyncRender();
    });
    expect(localStorage.getItem(NFM_SEND_TO_THREAD_MODE_STORAGE_KEY)).toBe("send");

    await act(async () => {
      fireEvent.click(view.getByRole("option", { name: /New thread/ }));
      await settleAsyncRender();
    });

    await waitFor(() => {
      expect(actions.sendRequests.length).toBe(2);
    });
    expect(actions.sendRequests[1]?.mode).toBe("send");
    expect(actions.sendRequests[1]?.target.kind).toBe("new-thread");
  });

  test("initializes the send-to-chat picker mode from persisted app preference", async () => {
    localStorage.setItem(NFM_SEND_TO_THREAD_MODE_STORAGE_KEY, "wrap-toggle");

    const view = render(
      <NodexTooltipProvider>
        <NfmSendToThreadMenuSurface
          projectId="default"
          threads={SEND_TO_THREAD_THREADS}
          onAccept={() => undefined}
          onClose={() => undefined}
        />
      </NodexTooltipProvider>,
    );
    await settleAsyncRender();

    expect(view.getByRole("button", { name: "Send" }).getAttribute("aria-pressed")).toBe("false");
    expect(view.getByRole("button", { name: "Send & wrap" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("hands More off to block actions without opening the legacy dropdown", async () => {
    const { actions, view } = renderTextActionMenu();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "More" }));
      await settleAsyncRender();
    });

    expect(actions.blockActions).toBe(1);
    expect(view.queryByRole("menuitem", { name: "Block actions" }) === null).toBeTrue();
    expect(view.queryByRole("menuitem", { name: "Duplicate" }) === null).toBeTrue();
  });

  test("opens the shared move-to popover and submits DB and Card destinations", async () => {
    const { actions, view } = renderTextActionMenu({
      renderMoveToMenu: (props) => (
        <NfmMoveToMenuSurface
          {...props}
          projects={MOVE_TO_PROJECTS}
          boardMap={MOVE_TO_BOARD_MAP}
          loading={false}
          loadError={null}
        />
      ),
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Move to" }));
      await settleAsyncRender();
    });

    expect(Boolean(view.getByRole("combobox", { name: "Move blocks to" }))).toBeTrue();
    expect(Boolean(view.getByText("DB"))).toBeTrue();
    expect(Boolean(view.getByText("Card"))).toBeTrue();
    expect(view.queryByText("Move to card") === null).toBeTrue();
    expect(view.queryByText("Turn into cards") === null).toBeTrue();
    expect(view.queryByText("Source card") === null).toBeTrue();

    await act(async () => {
      fireEvent.click(view.getByRole("option", { name: "Renderer parity" }));
      await settleAsyncRender();
    });

    await act(async () => {
      fireEvent.click(view.getByRole("option", { name: "Backlog Renderer parity" }));
      await settleAsyncRender();
    });

    await waitFor(() => {
      expect(actions.moveDestinations.length).toBe(1);
    });
    expect(actions.moveDestinations[0]?.kind).toBe("db-column");
    expect(actions.moveDestinations[0]?.projectId).toBe("renderer");
    expect(actions.moveDestinations[0]?.columnId).toBe("backlog");

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Move to" }));
      await settleAsyncRender();
    });

    await act(async () => {
      fireEvent.click(view.getByRole("option", { name: "Target card Default / Draft" }));
      await settleAsyncRender();
    });

    await waitFor(() => {
      expect(actions.moveDestinations.length).toBe(2);
    });
    const cardDestination = actions.moveDestinations[1];
    expect(cardDestination?.kind).toBe("card");
    if (cardDestination?.kind !== "card") {
      throw new Error("expected card destination");
    }
    expect(cardDestination.projectId).toBe("default");
    expect(cardDestination.columnId).toBe("draft");
    expect(cardDestination.cardId).toBe("target-card");
  });

  test("keeps only one Nodex action popover open", async () => {
    const { view } = renderTextActionMenu({
      renderSendToThreadMenu: (props) => (
        <NfmSendToThreadMenuSurface
          {...props}
          threads={SEND_TO_THREAD_THREADS}
        />
      ),
      renderMoveToMenu: (props) => (
        <NfmMoveToMenuSurface
          {...props}
          projects={MOVE_TO_PROJECTS}
          boardMap={MOVE_TO_BOARD_MAP}
          loading={false}
          loadError={null}
        />
      ),
    });

    await act(async () => {
      fireEvent.pointerEnter(view.getByRole("button", { name: "Send to chat" }));
      await settleAsyncRender();
    });
    expect(Boolean(view.getByRole("dialog", { name: "Send to chat" }))).toBeTrue();

    await act(async () => {
      fireEvent.pointerEnter(view.getByRole("button", { name: "Move to" }));
      await settleAsyncRender();
    });

    expect(view.queryByRole("dialog", { name: "Send to chat" }) === null).toBeTrue();
    expect(Boolean(view.getByRole("dialog", { name: "Move to" }))).toBeTrue();
  });

  test("shows hover tooltips for icon-only formatting buttons", async () => {
    const { view } = renderTextActionMenu();

    await act(async () => {
      fireEvent.pointerMove(view.getByRole("button", { name: "Italic" }));
      await settleAsyncRender();
    });

    expect(view.getAllByText("Italic").length > 0).toBeTrue();
  });

  test("does not show action or skill row tooltips when labels are fully visible", async () => {
    const { view } = renderTextActionMenu();
    const actionRow = view.getByRole("button", { name: "Send to chat" });
    const skillRow = view.getByRole("button", { name: "Improve writing" });

    await act(async () => {
      fireEvent.pointerEnter(actionRow);
      fireEvent.pointerEnter(skillRow);
      await settleAsyncRender();
    });

    expect(view.getAllByText("Send to chat").length).toBe(1);
    expect(view.getAllByText("Improve writing").length).toBe(1);
  });

  test("shows action row tooltips only when labels overflow", async () => {
    const longLabel = "Move selected blocks into another card";
    const { view } = renderTextActionMenu({
      nodexRows: [
        {
          key: "convert-divider-to-thread-section",
          label: longLabel,
          enabled: true,
        },
      ],
    });
    const label = view.getByText(longLabel);
    const actionRow = view.getByRole("button", { name: longLabel });

    Object.defineProperty(label, "clientWidth", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(label, "scrollWidth", {
      configurable: true,
      value: 240,
    });

    await act(async () => {
      fireEvent.pointerEnter(actionRow);
      await settleAsyncRender();
    });

    expect(view.getAllByText(longLabel).length > 1).toBeTrue();
  });

  test("renders the color trigger as a DOM A over the selected background", () => {
    const { view } = renderTextActionMenu({
      textColor: "blue",
      backgroundColor: "yellow",
    });

    const colorButton = view.getByRole("button", { name: "Color" });

    expect(colorButton.textContent).toBe("A");
    expect(colorButton.querySelector("svg") === null).toBeTrue();
  });

  test("opens the Notion-style color grid in fixture order", async () => {
    const { view } = renderTextActionMenu();

    await openColorMenu(view);

    expect(Boolean(view.getByRole("dialog", { name: "Color" }))).toBeTrue();
    expect(Boolean(view.getByText("Recently used"))).toBeTrue();
    expect(Boolean(view.getByText("Text color"))).toBeTrue();
    expect(Boolean(view.getByText("Background color"))).toBeTrue();

    const itemLabels = view
      .getAllByRole("menuitem")
      .map((item) => item.getAttribute("aria-label"))
      .join("|");

    expect(itemLabels).toBe(
      "Recently used: Yellow background"
      + "|Text color: Default|Text color: Gray|Text color: Brown|Text color: Orange|Text color: Yellow|Text color: Green|Text color: Blue|Text color: Purple|Text color: Pink|Text color: Red"
      + "|Background color: Default|Background color: Gray|Background color: Brown|Background color: Orange|Background color: Yellow|Background color: Green|Background color: Blue|Background color: Purple|Background color: Pink|Background color: Red",
    );
  });

  test("renders five persisted recently-used color slots before the color grids", async () => {
    writeTextActionRecentColors([
      { kind: "text", color: "blue" },
      { kind: "text", color: "pink" },
      { kind: "background", color: "red" },
      { kind: "background", color: "purple" },
      { kind: "background", color: "green" },
    ]);
    const { view } = renderTextActionMenu();

    await openColorMenu(view);

    const firstSixItemLabels = view
      .getAllByRole("menuitem")
      .slice(0, 6)
      .map((item) => item.getAttribute("aria-label"))
      .join("|");

    expect(firstSixItemLabels).toBe(
      "Recently used: Blue text"
      + "|Recently used: Pink text"
      + "|Recently used: Red background"
      + "|Recently used: Purple background"
      + "|Recently used: Green background"
      + "|Text color: Default",
    );
  });

  test("delegates color swatches and reuses the persisted recent color", async () => {
    const { actions, view } = renderTextActionMenu();

    await openColorMenu(view);
    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Text color: Blue" }));
      await settleAsyncRender();
    });

    expect(actions.textColors.join(",")).toBe("blue");
    expect(Boolean(view.getByRole("dialog", { name: "Color" }))).toBeTrue();

    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Recently used: Blue text" }));
      await settleAsyncRender();
    });

    expect(actions.textColors.join(",")).toBe("blue,blue");
    expect(Boolean(view.getByRole("dialog", { name: "Color" }))).toBeTrue();

    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Background color: Yellow" }));
      await settleAsyncRender();
    });

    expect(actions.backgroundColors.join(",")).toBe("yellow");
    expect(Boolean(view.getByRole("dialog", { name: "Color" }))).toBeTrue();
  });

  test("toggles the active text and background colors back to default without closing", async () => {
    const { actions, view } = renderTextActionMenu({
      textColor: "blue",
      backgroundColor: "yellow",
    });

    await openColorMenu(view);

    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Text color: Blue" }));
      await settleAsyncRender();
    });

    expect(actions.textColors.join(",")).toBe("default");
    expect(Boolean(view.getByRole("dialog", { name: "Color" }))).toBeTrue();

    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Background color: Yellow" }));
      await settleAsyncRender();
    });

    expect(actions.backgroundColors.join(",")).toBe("default");
    expect(Boolean(view.getByRole("dialog", { name: "Color" }))).toBeTrue();
  });

  test("keeps unsupported color controls inert", async () => {
    writeTextActionRecentColors([{ kind: "text", color: "blue" }]);
    const { actions, view } = renderTextActionMenu({
      canUseTextColor: false,
      canUseBackgroundColor: true,
    });

    await openColorMenu(view);

    expect(view.queryByText("Text color") === null).toBeTrue();
    expect(view.getByRole("menuitem", { name: "Recently used: Blue text" }).getAttribute("aria-disabled")).toBe("true");

    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Recently used: Blue text" }));
      await settleAsyncRender();
    });

    expect(actions.textColors.length).toBe(0);
    expect(actions.backgroundColors.length).toBe(0);
  });

  test("disables the color trigger when no color style is supported", async () => {
    const { view } = renderTextActionMenu({
      canUseTextColor: false,
      canUseBackgroundColor: false,
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Color" }));
      await settleAsyncRender();
    });

    expect(view.getByRole("button", { name: "Color" }).getAttribute("aria-disabled")).toBe("true");
    expect(view.queryByRole("dialog", { name: "Color" }) === null).toBeTrue();
  });

  test("does not fire disabled reference mock actions", async () => {
    const { actions, view } = renderTextActionMenu();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Equation" }));
      fireEvent.click(view.getByRole("button", { name: "Write a comment" }));
      await settleAsyncRender();
    });

    expect(actions.styles.length).toBe(0);
    expect(actions.clearFormat).toBe(0);
    expect(actions.nodexRows.length).toBe(0);
  });
});
