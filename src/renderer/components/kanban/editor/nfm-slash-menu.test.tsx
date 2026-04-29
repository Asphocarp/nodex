import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { getNfmSlashMenuCustomItems, NfmSuggestionMenuSurface, resolveNfmSuggestionHint } from "./nfm-slash-menu";
import type { DefaultReactSuggestionItem } from "@blocknote/react";

function makeItems(): DefaultReactSuggestionItem[] {
  return [
    {
      title: "Paragraph",
      subtext: "Plain text block",
      badge: "text",
      aliases: [],
      group: "Basic",
      icon: <span aria-hidden="true">P</span>,
      onItemClick: () => undefined,
    },
    {
      title: "Agent Config",
      subtext: "Insert a one-send plan-mode config chip",
      badge: "/agent-config",
      aliases: [],
      group: "Others",
      icon: <span aria-hidden="true">A</span>,
      onItemClick: () => undefined,
    },
  ];
}

function renderSuggestionMenu(
  props: Parameters<typeof NfmSuggestionMenuSurface>[0],
) {
  return render(
    <NodexTooltipProvider>
      <NfmSuggestionMenuSurface {...props} />
    </NodexTooltipProvider>,
  );
}

describe("NfmSlashMenu", () => {
  test("agent config item inserts a plan-mode chip", () => {
    let insertedContent: unknown[] | null = null;
    let insertedUpdateSelection: boolean | null = null;
    const editor = {
      insertInlineContent: (content: unknown[], options?: { updateSelection?: boolean }) => {
        insertedContent = content;
        insertedUpdateSelection = options?.updateSelection ?? null;
      },
    };

    const item = getNfmSlashMenuCustomItems(editor, "default").find((candidate) => candidate.title === "Agent Config");
    expect(item !== undefined).toBeTrue();
    if (!item) return;

    item.onItemClick();

    expect(Array.isArray(insertedContent)).toBeTrue();
    const chip = insertedContent?.[0] as { type?: string; props?: Record<string, string> } | undefined;
    expect(chip?.type).toBe("agentConfig");
    expect(chip?.props?.mode).toBe("plan");
    expect(chip?.props?.model).toBe("");
    expect(chip?.props?.reasoning).toBe("");
    expect(insertedContent?.[1]).toBe(" ");
    expect(insertedUpdateSelection).toBeTrue();
  });

  test("renders grouped compact suggestion items with stable option ids", () => {
    const view = renderSuggestionMenu(
      {
        items: makeItems(),
        loadingState: "loaded",
        selectedIndex: 1,
        onItemClick: () => undefined,
      },
    );

    const list = view.getByRole("listbox");
    expect(list.id).toBe("bn-suggestion-menu");
    expect(view.getByText("Basic").textContent).toBe("Basic");
    expect(view.getByText("Others").textContent).toBe("Others");
    expect(view.queryByText("Plain text block")).toBe(null);

    const selected = view.container.querySelector("#bn-suggestion-menu-item-1");
    expect(selected).not.toBeNull();
    expect(selected?.getAttribute("role")).toBe("option");
    expect(selected?.getAttribute("aria-selected")).toBe("true");
    expect(selected?.textContent?.includes("Agent Config")).toBeTrue();
    expect(selected?.textContent?.includes("/agent-config")).toBeTrue();
  });

  test("resolves syntax hints from known keys, badges, and slash aliases", () => {
    expect(resolveNfmSuggestionHint({ title: "Heading 2", key: "heading_2" } as DefaultReactSuggestionItem & { key: string })).toBe("##");
    expect(resolveNfmSuggestionHint({
      title: "Custom",
      aliases: ["custom-command"],
      onItemClick: () => undefined,
    })).toBe("/custom-command");
    expect(resolveNfmSuggestionHint({
      title: "Mention card",
      badge: "@",
      onItemClick: () => undefined,
    })).toBe("@");
  });

  test("clicking a suggestion item dispatches the selected item", () => {
    let clickedTitle = "";
    const view = renderSuggestionMenu(
      {
        items: makeItems(),
        loadingState: "loaded",
        selectedIndex: 0,
        onItemClick: (item) => {
          clickedTitle = item.title;
        },
      },
    );

    fireEvent.click(view.getByText("Agent Config"));

    expect(clickedTitle).toBe("Agent Config");
  });

  test("renders compact empty and loading states", () => {
    const emptyView = renderSuggestionMenu(
      {
        items: [],
        loadingState: "loaded",
        selectedIndex: undefined,
        onItemClick: () => undefined,
      },
    );

    expect(emptyView.getByText("No matching commands").textContent).toBe("No matching commands");
    emptyView.unmount();

    const loadingView = renderSuggestionMenu(
      {
        items: [],
        loadingState: "loading",
        selectedIndex: undefined,
        onItemClick: () => undefined,
      },
    );

    expect(loadingView.getByText("Loading...").textContent).toBe("Loading...");
  });

  test("long labels stay in a truncated one-line text lane", () => {
    const longTitle = "Very long command label that should stay inside the compact suggestion menu row";
    const longSubtext = "Very long description that should not force the menu to become chunky or overflow the viewport";
    const view = renderSuggestionMenu(
      {
        items: [{
          title: longTitle,
          subtext: longSubtext,
          aliases: [],
          group: "Long",
          onItemClick: () => undefined,
        }],
        loadingState: "loaded",
        selectedIndex: 0,
        onItemClick: () => undefined,
      },
    );

    expect(view.getByText(longTitle).className.includes("truncate")).toBeTrue();
    expect(view.queryByText(longSubtext)).toBe(null);
  });

  test("description details are disclosed through the item tooltip", async () => {
    const view = renderSuggestionMenu(
      {
        items: makeItems(),
        loadingState: "loaded",
        selectedIndex: 0,
        onItemClick: () => undefined,
      },
    );

    const row = view.container.querySelector("#bn-suggestion-menu-item-0") as HTMLElement | null;
    expect(row).not.toBeNull();
    if (!row) return;

    await act(async () => {
      fireEvent.focus(row);
      await settleAsyncRender();
    });

    const tooltip = view.container.ownerDocument.body.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toBe("Plain text block");
    expect(tooltip?.textContent?.includes("Paragraph")).toBeFalse();
  });
});
