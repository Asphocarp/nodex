import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  TEXT_ACTION_RECENT_COLOR_STORAGE_KEY,
  writeTextActionRecentColors,
} from "@/lib/text-action-color-recents";
import { render, settleAsyncRender } from "@/test/dom";
import { NfmTextActionMenuSurface, type NfmTextActionMenuSurfaceProps } from "./nfm-text-action-menu";

function renderTextActionMenu(
  props?: Partial<NfmTextActionMenuSurfaceProps>,
) {
  const actions = {
    blockTypes: [] as string[],
    styles: [] as string[],
    textColors: [] as string[],
    backgroundColors: [] as string[],
    clearFormat: 0,
    nodexRows: [] as string[],
    convertDivider: 0,
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
            key: "send-section-to-codex",
            label: "Send to chat",
            enabled: true,
          },
          {
            key: "append-blocks-to-card",
            label: "Move to card",
            enabled: true,
            mode: "card",
          },
        ]}
        canConvertDividerToThreadSection={true}
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
        onNodexRow={(row) => {
          actions.nodexRows.push(row.key);
        }}
        onConvertDividerToThreadSection={() => {
          actions.convertDivider += 1;
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
      fireEvent.click(view.getByRole("button", { name: "Send to chat" }));
      await settleAsyncRender();
    });

    expect(actions.styles.join(",")).toBe("bold");
    expect(actions.clearFormat).toBe(1);
    expect(actions.nodexRows.join(",")).toBe("send-section-to-codex");
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
          key: "append-blocks-to-card",
          label: longLabel,
          enabled: true,
          mode: "card",
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
