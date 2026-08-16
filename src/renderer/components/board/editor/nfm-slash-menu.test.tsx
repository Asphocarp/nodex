import { describe, expect, test, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  buildPageReferenceCandidateSuggestionItems,
  buildNfmDateMentionInlineContent,
  buildNfmDateMentionSuggestionItems,
  buildNfmThreadMentionInlineContent,
  buildNfmThreadMentionSuggestionItems,
  getNfmSlashMenuCustomItems,
  isPageReferenceInsertionBookmarkValid,
  NFM_SUGGESTION_MENU_CONTROLLER_PORTAL_PROPS,
  NfmSuggestionMenuSurface,
  type NfmSuggestionItem,
  resolveThreadMentionSubtext,
  resolveNfmSuggestionHint,
  selectNfmMentionSuggestionItems,
  scrollElementIntoContainerView,
  startNfmMentionAtCursor,
} from "./nfm-slash-menu";

import {
  NFM_SUGGESTION_MENU_TOOLTIP_Z_INDEX,
  NFM_SUGGESTION_MENU_Z_INDEX,
} from "./nfm-blocknote-floating-ui";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  BlockNoteContext,
  SuggestionMenuWrapper,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
} from "@blocknote/react";
import type { CommandPaletteThread } from "@/lib/command-palette";
import type { CodexThreadSummary, Project } from "@/lib/types";
import { DEFAULT_PROJECT_APPEARANCE } from "../../../../shared/project-appearance";

describe("Page reference insertion bookmark", () => {
  test("accepts only the still-current source Block", () => {
    const editor = {
      getBlock: (blockId: string) => blockId === "source" ? { id: blockId } : undefined,
      getTextCursorPosition: () => ({ block: { id: "source" } }),
    };

    expect(isPageReferenceInsertionBookmarkValid(editor, { blockId: "source" })).toBe(true);
    expect(isPageReferenceInsertionBookmarkValid(editor, { blockId: "missing" })).toBe(false);
    expect(isPageReferenceInsertionBookmarkValid(editor, null)).toBe(false);
  });

  test("fails closed after the selection moves", () => {
    const editor = {
      getBlock: () => ({ id: "source" }),
      getTextCursorPosition: () => ({ block: { id: "other" } }),
    };

    expect(isPageReferenceInsertionBookmarkValid(editor, { blockId: "source" })).toBe(false);
  });
});

function makeItems(): NfmSuggestionItem[] {
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
      hint: null,
      aliases: ["agent-config"],
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
    libraryId: "library:test",
    databaseId: "database:test:primary",
    defaultDatabaseViewId: "view:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name: "Alpha",
    description: "",
    appearance: DEFAULT_PROJECT_APPEARANCE,
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-06-20T00:00:00.000Z"),
    updated: new Date("2026-06-20T00:00:00.000Z"),
  };
}

function makePaletteThread(overrides: Partial<CommandPaletteThread> = {}): CommandPaletteThread {
  return {
    kind: "thread",
    id: overrides.id ?? "thread:thr-mention",
    threadId: overrides.threadId ?? "thr-mention",
    sessionId: overrides.sessionId === undefined ? "session-1" : overrides.sessionId,
    projectId: overrides.projectId === undefined ? "project-1" : overrides.projectId,
    projectName: overrides.projectName === undefined ? "Alpha" : overrides.projectName,
    title: overrides.title ?? "Mention search thread",
    preview: overrides.preview ?? "Shared picker search.",
    cwd: overrides.cwd ?? "/tmp/project",
    gitBranch: overrides.gitBranch ?? null,
    projectless: overrides.projectless ?? false,
    pinned: overrides.pinned ?? false,
    pinnedOrder: overrides.pinnedOrder ?? null,
    statusType: overrides.statusType ?? "notLoaded",
    statusActiveFlags: overrides.statusActiveFlags ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
    inActiveProject: overrides.inActiveProject ?? true,
    searchPreview: overrides.searchPreview,
    searchDecorations: overrides.searchDecorations,
  };
}

describe("NfmSlashMenu", () => {
  test("turns the slash command into the normal visible @ mention flow", () => {
    const openSuggestionMenu = vi.fn();

    startNfmMentionAtCursor({
      getExtension: () => ({ openSuggestionMenu }),
    });

    expect(openSuggestionMenu).toHaveBeenCalledWith("@", {
      deleteTriggerCharacter: true,
      ignoreQueryLength: true,
    });
  });

  test("slash commands never create unresolved Page or legacy Database references", () => {
    const items = getNfmSlashMenuCustomItems({});
    const keys = items
      .map((item) => (item as { key?: string }).key ?? "")
      .join(",");

    expect(keys.includes("card_reference")).toBe(false);
    expect(keys.includes("toggle_list_inline_view")).toBe(false);
    expect(keys.includes("thread_section")).toBe(true);
    expect(keys.includes("agent_config")).toBe(true);
    expect(keys.includes("canvas")).toBe(false);
    expect(
      getNfmSlashMenuCustomItems({}, {
        createCanvasAtEmptyParagraph: async () => ({
          canvasBlockId: "canvas-1",
        }),
      }).some((item) => (item as { key?: string }).key === "canvas"),
    ).toBe(true);

    let mentionOpened = false;
    let embedOpened = false;
    const pageItems = getNfmSlashMenuCustomItems({}, {
      startMentionFlow: () => {
        mentionOpened = true;
      },
      openEmbedPagePicker: () => {
        embedOpened = true;
      },
    });
    const mentionPageItem = pageItems.find(
      (item) => (item as { key?: string }).key === "mention_page",
    );
    expect(mentionPageItem?.title).toBe("Mention a page");
    mentionPageItem?.onItemClick();
    expect(mentionOpened).toBe(true);

    const embedPageItem = pageItems.find(
      (item) => (item as { key?: string }).key === "embed_page",
    );
    expect(embedPageItem?.title).toBe("Embed page");
    embedPageItem?.onItemClick();
    expect(embedOpened).toBe(true);
  });

  test("keeps action aliases searchable without presenting them as syntax hints", () => {
    const items = getNfmSlashMenuCustomItems({}, {
      createCanvasAtEmptyParagraph: async () => ({
        canvasBlockId: "canvas-1",
      }),
      startMentionFlow: () => undefined,
      openEmbedPagePicker: () => undefined,
      openSubpageCreator: () => undefined,
    }) as NfmSuggestionItem[];
    const actionKeys = [
      "table",
      "canvas",
      "mention_page",
      "embed_page",
      "subpage",
      "thread_section",
      "agent_config",
    ];
    const actionItems = items.filter((item) =>
      item.key ? actionKeys.includes(item.key) : false
    );

    expect(actionItems.map((item) => item.key)).toEqual(actionKeys);
    for (const item of actionItems) {
      expect(item.aliases ?? []).not.toHaveLength(0);
      expect(resolveNfmSuggestionHint(item)).toBe(null);
    }
  });

  test("thread mention subtext suppresses default idle labels but keeps actionable states", () => {
    const project = createMentionProject();

    expect(resolveThreadMentionSubtext(createMentionThread(), project)).toBe("Alpha / 019-thread");
    expect(resolveThreadMentionSubtext(createMentionThread({
      statusType: "active",
      statusActiveFlags: ["waitingOnUserInput"],
    }), project)).toBe("Alpha / Waiting / 019-thread");
  });

  test("Page candidates expose only disambiguation or content-match detail", () => {
    const insertInlineContent = vi.fn();
    const items = buildPageReferenceCandidateSuggestionItems(
      { insertInlineContent },
      [
        {
          pageId: "page-title",
          title: "Projection notes",
          pageKey: "NDX-42",
          status: "build",
          locationLabel: "Product / Editor",
          lifecycle: "active",
          matchExcerpt: "Projection notes",
          matchSource: "title",
          disabledReason: null,
        },
        {
          pageId: "page-content",
          title: "Architecture",
          pageKey: "NDX-7",
          status: null,
          locationLabel: "Product / Foundations",
          lifecycle: "active",
          matchExcerpt: "The affected projection window stays bounded.",
          matchSource: "content",
          disabledReason: null,
        },
      ],
      "mention",
      "projection",
    );

    expect(items[0]).toMatchObject({
      title: "Projection notes",
      detail: null,
      group: "Mention a page",
    });
    expect(items[0]?.tooltipContent).not.toBeNull();
    expect(items[1]).toMatchObject({
      title: "Architecture",
      detail: "The affected projection window stays bounded.",
      group: "Mention a page",
    });
    expect(items[1]?.tooltipContent).not.toBeNull();
    const view = renderSuggestionMenu({
      items,
      loadingState: "loaded",
      selectedIndex: 0,
      onItemClick: () => undefined,
    });
    const [statusRow, genericPageRow] = view.getAllByRole("option");
    expect(statusRow?.querySelector("svg")?.classList.contains("size-4")).toBe(true);
    expect(statusRow?.querySelector("svg")?.getAttribute("style"))
      .toContain("--status-build-dot");
    expect(genericPageRow?.querySelector("svg")?.classList.contains("icon-xs"))
      .toBe(true);
    items[1]?.onItemClick();
    expect(insertInlineContent).toHaveBeenCalledWith([
      { type: "pageMention", props: { targetPageId: "page-content" } },
      " ",
    ], { updateSelection: true });
  });

  test("mention payload helpers preserve thread and date inline storage shapes", () => {
    const threadContent = buildNfmThreadMentionInlineContent(makePaletteThread({
      threadId: "thr-payload",
    })) as Array<{ type?: string; props?: { uuid?: string } } | string>;
    const firstThreadContent = threadContent[0];
    expect(typeof firstThreadContent === "string").toBe(false);
    if (typeof firstThreadContent === "string") return;
    expect(firstThreadContent?.type).toBe("threadMention");
    expect(firstThreadContent?.props?.uuid).toBe("thr-payload");
    expect(threadContent[1]).toBe(" ");
  });

  test("thread rows disclose only duplicate-title context or content excerpts", () => {
    const items = buildNfmThreadMentionSuggestionItems(
      {},
      [
        makePaletteThread({
          threadId: "other-thread",
          id: "thread:other-thread",
          title: "Weekly planning",
          projectId: "project-2",
          projectName: "Beta",
          inActiveProject: false,
        }),
        makePaletteThread({
          threadId: "active-thread",
          id: "thread:active-thread",
          title: "Weekly planning",
          inActiveProject: true,
        }),
        makePaletteThread({
          threadId: "content-thread",
          id: "thread:content-thread",
          title: "Architecture review",
          searchPreview: {
            source: "content",
            excerpt: "Only transcript content matched vector clocks.",
            segments: [],
          },
        }),
      ],
      "vector",
    );

    expect(items[0]?.detail).toBe("Beta");
    expect(items[1]?.detail).toBe("Alpha");
    expect(items[2]?.detail).toBe(
      "…content matched vector clocks.",
    );
    expect(items.every((item) => item.tooltipContent !== null)).toBe(true);
  });

  test("maps an app-server-only chat into a thread mention suggestion", () => {
    const items = buildNfmThreadMentionSuggestionItems(
      {},
      [makePaletteThread({
        id: "thread:server-only-mention",
        threadId: "server-only-mention",
        sessionId: null,
        title: "Historical mention target",
        searchPreview: {
          source: "content",
          excerpt: "Mention evidence from app-server history.",
          segments: [{ text: "Mention evidence", highlight: true }],
        },
      })],
      "evidence",
    );

    expect(items[0]).toMatchObject({
      title: "Historical mention target",
      group: "Mention a chat",
      detail: "Mention evidence from app-server history.",
    });
  });

  test("date mention suggestions are first for date-like queries and insert inline content", () => {
    expect(buildNfmDateMentionSuggestionItems({}, "").map(({ title }) => title))
      .toEqual(["Today", "Now"]);
    const items = selectNfmMentionSuggestionItems("today", [
      ...buildNfmThreadMentionSuggestionItems(
        {},
        [makePaletteThread({ title: "Today planning" })],
        "today",
      ),
      ...buildNfmDateMentionSuggestionItems({}, "today"),
    ]);

    expect(items.length > 0).toBe(true);
    expect(items[0]?.title).toBe("Today");
    expect(items[0]?.group).toBe("Date");
    expect(items[1]?.title).toBe("Remind today");
    expect(items[1]?.group).toBe("Date");
    expect(items[2]?.title).toBe("Today planning");
    expect(items[2]?.group).toBe("Mention a chat");

    const inlineContent = buildNfmDateMentionInlineContent({
      type: "dateMention",
      start: "2026-06-28",
      format: "relative",
    }) as Array<{ type?: string; props?: Record<string, string> } | string>;
    const first = inlineContent[0];
    expect(typeof first === "string").toBe(false);
    if (typeof first === "string") return;
    expect(first.type).toBe("dateMention");
    expect(first.props?.start).toBe("2026-06-28");
    expect(first.props?.format).toBe("relative");
    expect(inlineContent[1]).toBe(" ");
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

    const item = getNfmSlashMenuCustomItems(editor).find((candidate) => candidate.title === "Agent Config");
    expect(item !== undefined).toBe(true);
    if (!item) return;

    item.onItemClick();

    expect(Array.isArray(insertedContent)).toBe(true);
    const chip = insertedContent?.[0] as { type?: string; props?: Record<string, string> } | undefined;
    expect(chip?.type).toBe("agentConfig");
    expect(chip?.props?.mode).toBe("plan");
    expect(chip?.props?.model).toBe("");
    expect(chip?.props?.reasoning).toBe("");
    expect(insertedContent?.[1]).toBe(" ");
    expect(insertedUpdateSelection).toBe(true);
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
    expect(selected?.textContent?.includes("Agent Config")).toBe(true);
    expect(selected?.textContent?.includes("/agent-config")).toBe(false);
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
      title: "Mention page",
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

  test("marks populated stale suggestion results as updating", () => {
    const view = renderSuggestionMenu(
      {
        items: makeItems(),
        loadingState: "loaded",
        itemsStale: true,
        selectedIndex: 0,
        onItemClick: () => undefined,
      },
    );

    expect(view.getByRole("listbox").getAttribute("aria-busy")).toBe("true");
    expect(view.getByText("Updating...").textContent).toBe("Updating...");
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

  test("mention rows render only explicit inline detail", () => {
    const view = renderSuggestionMenu(
      {
        items: [{
          key: "page:target",
          title: "Projection notes",
          subtext: "This legacy field is not row detail",
          detail: "Product / Editor",
          tooltipContent: null,
          aliases: [],
          group: "Pages",
          onItemClick: () => undefined,
        } as NfmSuggestionItem],
        loadingState: "loaded",
        selectedIndex: 0,
        onItemClick: () => undefined,
      },
    );

    expect(view.getByText("Projection notes").textContent).toBe("Projection notes");
    expect(view.getByText("Product / Editor").textContent)
      .toBe("Product / Editor");
    expect(view.queryByText("This legacy field is not row detail")).toBe(null);
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
    expect(tooltip?.textContent?.includes("Paragraph")).toBe(false);
    const tooltipLayer = tooltip?.closest('[data-radix-popper-content-wrapper]') as HTMLElement | null;
    expect(tooltipLayer?.style.zIndex).toBe(String(NFM_SUGGESTION_MENU_TOOLTIP_Z_INDEX));
  });

  test("mention details highlight the match and retain useful full tooltips", async () => {
    const fullExcerpt = `${"Earlier context ".repeat(10)}Compact transcript snippet. ${"Later context ".repeat(10)}`;
    const items = buildNfmThreadMentionSuggestionItems({}, [
      makePaletteThread({
        title: "Searchable thread",
        searchPreview: {
          source: "content",
          excerpt: fullExcerpt,
          segments: [{ text: fullExcerpt, highlight: true }],
        },
      }),
    ], "compact");
    const view = renderSuggestionMenu(
      {
        items,
        loadingState: "loaded",
        selectedIndex: 0,
        onItemClick: () => undefined,
      },
    );

    const row = view.container.querySelector("#bn-suggestion-menu-item-0") as HTMLElement | null;
    expect(row).not.toBeNull();
    if (!row) return;
    expect(row.textContent?.includes("…")).toBe(true);
    expect(row.textContent?.includes("Compact transcript snippet.")).toBe(true);
    const highlighted = row.querySelector(".font-medium");
    expect(highlighted?.textContent).toBe("Compact");

    await act(async () => {
      fireEvent.focus(row);
      await settleAsyncRender();
    });

    const tooltip = view.container.ownerDocument.body.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent?.includes("Searchable thread")).toBe(true);
    expect(tooltip?.textContent?.includes(fullExcerpt.trim())).toBe(true);
  });

  test("lets pointer and keyboard selection expand a section without selecting a mention", () => {
    const query = "weekly";
    const sourceItems = Array.from({ length: 9 }, (_, index) => ({
        ...buildNfmThreadMentionSuggestionItems(
          {},
          [makePaletteThread({
            id: `thread:${index}`,
            threadId: `thread-${index}`,
            title: `Weekly ${index}`,
          })],
          "weekly",
        )[0]!,
        mentionRank: {
          family: "chat" as const,
          match: "title" as const,
          activeContext: true,
          sourceOrder: index,
        },
      }));
    let expandedFamily: "chat" | null = null;
    const items = selectNfmMentionSuggestionItems(
      query,
      sourceItems,
      { onExpandSection: (family) => { expandedFamily = family as "chat"; } },
    );
    const view = renderSuggestionMenu({
      items,
      loadingState: "loaded",
      selectedIndex: 4,
      onItemClick: (item) => { item.onItemClick(); },
    });

    expect(view.getAllByRole("option")).toHaveLength(5);
    const moreRow = view.getByRole("option", { name: "5 more results" });
    expect(moreRow.getAttribute("data-selected")).toBe("true");
    expect(moreRow.getAttribute("data-mention-utility")).toBe("expand_section");
    fireEvent.click(moreRow);
    expect(expandedFamily).toBe("chat");

    view.unmount();
    const expandedItems = selectNfmMentionSuggestionItems(
      query,
      sourceItems,
      { expandedFamilies: new Set(["chat"]) },
    );
    const expandedView = renderSuggestionMenu({
      items: expandedItems,
      loadingState: "loaded",
      selectedIndex: 4,
      onItemClick: () => undefined,
    });
    expect(expandedView.getAllByRole("option")).toHaveLength(9);
    expect(expandedView.queryByText("5 more results")).toBeNull();
  });

  test("keeps the live suggestion menu open for pointer and Enter on utility rows", async () => {
    let closeMenuCalls = 0;
    let clearQueryCalls = 0;
    let activationCalls = 0;
    const editorElement = document.createElement("div");
    const suggestionMenu = {
      getMenuState: () => ({
        triggerCharacter: "@",
        query: "weekly",
        show: true,
      }),
    };
    const editor = {
      domElement: editorElement,
      _tiptapEditor: { on: () => undefined, off: () => undefined },
      getExtension: () => suggestionMenu,
    } as unknown as BlockNoteEditor;
    const UtilityMenu = ({ items, onItemClick }: SuggestionMenuProps<string>) => (
      <button type="button" onClick={() => onItemClick?.(items[0]!)}>
        5 more results
      </button>
    );
    const view = render(
      <BlockNoteContext.Provider
        value={{ editor, setContentEditableProps: () => undefined }}
      >
        <SuggestionMenuWrapper
          triggerCharacter="@"
          query="weekly"
          closeMenu={() => { closeMenuCalls += 1; }}
          clearQuery={() => { clearQueryCalls += 1; }}
          getItems={async () => ["expand"]}
          onItemClick={() => { activationCalls += 1; }}
          shouldCloseOnItemClick={() => false}
          suggestionMenuComponent={UtilityMenu}
        />
      </BlockNoteContext.Provider>,
    );

    await act(async () => {
      await settleAsyncRender();
    });
    fireEvent.click(view.getByText("5 more results"));
    await act(async () => {
      editorElement.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
    });

    expect(activationCalls).toBe(2);
    expect(closeMenuCalls).toBe(0);
    expect(clearQueryCalls).toBe(0);
  });

  test("keeps a long no-result mention query open for correction", async () => {
    let closeMenuCalls = 0;
    const suggestionMenu = {
      getMenuState: () => ({
        triggerCharacter: "@",
        query: "zzzz",
        show: true,
      }),
    };
    const editor = {
      domElement: document.createElement("div"),
      _tiptapEditor: { on: () => undefined, off: () => undefined },
      getExtension: () => suggestionMenu,
    } as unknown as BlockNoteEditor;
    const EmptyMentionMenu = () => <div>No matching mentions</div>;
    const view = render(
      <BlockNoteContext.Provider
        value={{ editor, setContentEditableProps: () => undefined }}
      >
        <SuggestionMenuWrapper
          triggerCharacter="@"
          query="zzzz"
          closeMenu={() => { closeMenuCalls += 1; }}
          clearQuery={() => undefined}
          getItems={async () => []}
          autoCloseWhenNoItems={false}
          suggestionMenuComponent={EmptyMentionMenu}
        />
      </BlockNoteContext.Provider>,
    );

    await act(async () => {
      await settleAsyncRender();
    });

    expect(view.getByText("No matching mentions")).toBeTruthy();
    expect(closeMenuCalls).toBe(0);
  });

  test("supports a mention-specific empty state", () => {
    const view = renderSuggestionMenu(
      {
        items: [],
        loadingState: "loaded",
        selectedIndex: undefined,
        onItemClick: () => undefined,
        emptyMessage: "No matching mentions",
      },
    );

    expect(view.getByText("No matching mentions").textContent)
      .toBe("No matching mentions");
  });
});
