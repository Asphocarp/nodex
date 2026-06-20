import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  getNfmSlashMenuCustomItems,
  NFM_SUGGESTION_MENU_CONTROLLER_PORTAL_PROPS,
  NfmSuggestionMenuSurface,
  resolveThreadMentionSubtext,
  resolveNfmSuggestionHint,
  scrollElementIntoContainerView,
} from "./nfm-slash-menu";
import {
  NFM_SUGGESTION_MENU_TOOLTIP_Z_INDEX,
  NFM_SUGGESTION_MENU_Z_INDEX,
} from "./nfm-blocknote-floating-ui";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { CodexThreadSummary, Project } from "@/lib/types";

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

function defineElementRect(
  element: HTMLElement,
  rect: { top: number; bottom: number; height: number },
) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    }),
  });
}

function defineClientHeight(element: HTMLElement, value: number) {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value,
  });
}

function createMentionThread(overrides: Partial<CodexThreadSummary> = {}): CodexThreadSummary {
  return {
    threadId: "019-thread",
    projectId: "project-1",
    source: null,
    threadName: "Thread title",
    threadPreview: "",
    modelProvider: "openai",
    cwd: "/tmp/project",
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

function createMentionProject(): Project {
  return {
    id: "project-1",
    name: "Alpha",
    description: "",
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-06-20T00:00:00.000Z"),
    updated: new Date("2026-06-20T00:00:00.000Z"),
  };
}

describe("NfmSlashMenu", () => {
  test("thread mention subtext suppresses default idle labels but keeps actionable states", () => {
    const project = createMentionProject();

    expect(resolveThreadMentionSubtext(createMentionThread(), project)).toBe("Alpha / 019-thread");
    expect(resolveThreadMentionSubtext(createMentionThread({
      statusType: "active",
      statusActiveFlags: ["waitingOnUserInput"],
    }), project)).toBe("Alpha / Waiting / 019-thread");
  });

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

  test("pins suggestion menu controllers to the body-level portal target", () => {
    expect(NFM_SUGGESTION_MENU_CONTROLLER_PORTAL_PROPS.portalElement).toBe(null);
    expect(NFM_SUGGESTION_MENU_CONTROLLER_PORTAL_PROPS.floatingUIOptions.useFloatingOptions?.strategy).toBe("fixed");
    expect(NFM_SUGGESTION_MENU_CONTROLLER_PORTAL_PROPS.floatingUIOptions.elementProps?.style?.zIndex).toBe(NFM_SUGGESTION_MENU_Z_INDEX);
  });

  test("scrolls selected suggestion rows within the menu list only", () => {
    const container = document.createElement("div");
    const item = document.createElement("button");
    container.appendChild(item);
    defineClientHeight(container, 100);
    defineElementRect(container, { top: 0, bottom: 100, height: 100 });

    container.scrollTop = 0;
    defineElementRect(item, { top: 20, bottom: 50, height: 30 });
    scrollElementIntoContainerView(container, item);
    expect(container.scrollTop).toBe(0);

    container.scrollTop = 80;
    defineElementRect(item, { top: -40, bottom: -10, height: 30 });
    scrollElementIntoContainerView(container, item);
    expect(container.scrollTop).toBe(40);

    container.scrollTop = 0;
    defineElementRect(item, { top: 120, bottom: 150, height: 30 });
    scrollElementIntoContainerView(container, item);
    expect(container.scrollTop).toBe(50);

    container.scrollTop = 0;
    defineElementRect(item, { top: 20, bottom: 180, height: 160 });
    scrollElementIntoContainerView(container, item);
    expect(container.scrollTop).toBe(0);
  });

  test("selected suggestion rows do not call native scrollIntoView", () => {
    const elementPrototype = HTMLElement.prototype as unknown as {
      scrollIntoView?: (options?: unknown) => void;
    };
    const originalScrollIntoView = elementPrototype.scrollIntoView;
    let scrollIntoViewCalls = 0;

    elementPrototype.scrollIntoView = function scrollIntoViewMock() {
      scrollIntoViewCalls += 1;
    };

    try {
      const view = renderSuggestionMenu(
        {
          items: makeItems(),
          loadingState: "loaded",
          selectedIndex: undefined,
          onItemClick: () => undefined,
        },
      );

      const list = view.container.querySelector('[data-nfm-suggestion-menu-scroll-list="true"]') as HTMLElement | null;
      const row = view.container.querySelector("#bn-suggestion-menu-item-1") as HTMLElement | null;
      expect(list).not.toBeNull();
      expect(row).not.toBeNull();
      if (!list || !row) return;

      defineClientHeight(list, 40);
      defineElementRect(list, { top: 0, bottom: 40, height: 40 });
      defineElementRect(row, { top: 60, bottom: 88, height: 28 });

      view.rerender(
        <NodexTooltipProvider>
          <NfmSuggestionMenuSurface
            items={makeItems()}
            loadingState="loaded"
            selectedIndex={1}
            onItemClick={() => undefined}
          />
        </NodexTooltipProvider>,
      );

      expect(scrollIntoViewCalls).toBe(0);
      expect(list.scrollTop).toBe(48);
    } finally {
      if (originalScrollIntoView) {
        elementPrototype.scrollIntoView = originalScrollIntoView;
      } else {
        delete elementPrototype.scrollIntoView;
      }
    }
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

  test("long labels render without exposing subtext in the menu row", () => {
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

    expect(view.getByText(longTitle).textContent).toBe(longTitle);
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
    const tooltipLayer = tooltip?.closest('[data-radix-popper-content-wrapper]') as HTMLElement | null;
    expect(tooltipLayer?.style.zIndex).toBe(String(NFM_SUGGESTION_MENU_TOOLTIP_Z_INDEX));
  });
});
