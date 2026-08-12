import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  buildNfmPageMentionBlock,
  buildNfmPageMentionSuggestionItem,
  buildNfmDateMentionInlineContent,
  buildNfmMentionSuggestionItems,
  buildNfmThreadMentionInlineContent,
  buildNfmThreadMentionSuggestionItem,
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
import type { CommandPalettePage, CommandPaletteThread } from "@/lib/command-palette";
import type { DatabasePageSummary, CodexThreadSummary, Project } from "@/lib/types";
import { plainTextToPortableRichText } from "../../../../shared/block-documents/portable-rich-text";
import { DEFAULT_PROJECT_APPEARANCE } from "../../../../shared/project-appearance";

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

function makePage(overrides: Partial<DatabasePageSummary> = {}): DatabasePageSummary {
  const descriptionPreview = overrides.descriptionPreview ?? "Add shared mention search.";
  const title = overrides.title ?? "Mention search page";
  return {
    id: overrides.id ?? "page-1",
    title,
    richTitle: overrides.richTitle ?? plainTextToPortableRichText(title),
    descriptionPreview,
    descriptionLength: overrides.descriptionLength ?? descriptionPreview.length,
    hasDescription: overrides.hasDescription ?? descriptionPreview.length > 0,
    status: overrides.status ?? "build",
    archived: overrides.archived ?? false,
    priority: overrides.priority,
    estimate: overrides.estimate,
    tags: overrides.tags ?? [],
    dueDate: overrides.dueDate,
    scheduledStart: overrides.scheduledStart,
    scheduledEnd: overrides.scheduledEnd,
    isAllDay: overrides.isAllDay ?? false,
    recurrence: overrides.recurrence,
    reminders: overrides.reminders ?? [],
    scheduleTimezone: overrides.scheduleTimezone,
    assignee: overrides.assignee,
    runInTarget: overrides.runInTarget ?? "localProject",
    runInLocalPath: overrides.runInLocalPath,
    runInBaseBranch: overrides.runInBaseBranch,
    runInWorktreePath: overrides.runInWorktreePath,
    runInEnvironmentPath: overrides.runInEnvironmentPath,
    revision: overrides.revision ?? 1,
    created: overrides.created ?? new Date("2026-06-20T00:00:00.000Z"),
    order: overrides.order ?? 0,
  };
}

function makePalettePage(overrides: Partial<CommandPalettePage> = {}): CommandPalettePage {
  const page = overrides.page ?? makePage();
  return {
    kind: "page",
    id: overrides.id ?? `${overrides.projectId ?? "project-1"}:${page.id}`,
    projectId: overrides.projectId ?? "project-1",
    projectName: overrides.projectName ?? "Alpha",
    projectAppearance: overrides.projectAppearance ?? DEFAULT_PROJECT_APPEARANCE,
    columnName: overrides.columnName ?? "Doing",
    page,
    tagLabels: overrides.tagLabels ?? page.tags,
    inActiveProject: overrides.inActiveProject ?? true,
    recentIndex: overrides.recentIndex ?? null,
    boardIndex: overrides.boardIndex ?? 0,
    searchPreview: overrides.searchPreview,
    searchDecorations: overrides.searchDecorations,
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
      getNfmSlashMenuCustomItems({}, async () => ({
        canvasBlockId: "canvas-1",
      })).some((item) => (item as { key?: string }).key === "canvas"),
    ).toBe(true);
  });

  test("thread mention subtext suppresses default idle labels but keeps actionable states", () => {
    const project = createMentionProject();

    expect(resolveThreadMentionSubtext(createMentionThread(), project)).toBe("Alpha / 019-thread");
    expect(resolveThreadMentionSubtext(createMentionThread({
      statusType: "active",
      statusActiveFlags: ["waitingOnUserInput"],
    }), project)).toBe("Alpha / Waiting / 019-thread");
  });

  test("mention suggestion builders expose command-palette snippets in compact row tooltips", () => {
    const editor = {};
    const cardItem = buildNfmPageMentionSuggestionItem(editor, makePalettePage({
      page: makePage({ id: "page-snippet", title: "Searchable page", status: "plan" }),
      searchPreview: {
        excerpt: "Description-only vector clock hit.",
        segments: [{ text: "Description-only vector clock hit.", highlight: true }],
      },
    }));
    const threadItem = buildNfmThreadMentionSuggestionItem(editor, makePaletteThread({
      threadId: "thr-snippet",
      searchPreview: {
        source: "content",
        excerpt: "Transcript-only approval heuristic hit.",
        segments: [{ text: "Transcript-only approval heuristic hit.", highlight: true }],
      },
    }));

    expect(cardItem.group).toBe("Pages");
    expect(cardItem.subtext?.includes("Description-only vector clock")).toBe(true);
    expect(cardItem.subtext?.includes("page-snippet")).toBe(false);
    expect(resolveNfmSuggestionHint(cardItem)).toBe(null);
    expect(threadItem.group).toBe("Chats");
    expect(threadItem.subtext?.includes("Transcript-only approval heuristic")).toBe(true);
    expect(threadItem.subtext?.includes("thr-snippet")).toBe(false);
    expect(resolveNfmSuggestionHint(threadItem)).toBe(null);
  });

  test("mention payload helpers preserve pageRef and threadMention storage shapes", () => {
    const pageRefBlock = buildNfmPageMentionBlock(makePalettePage({
      projectId: "project-2",
      page: makePage({ id: "page-2" }),
    })) as {
      type?: string;
      props?: Record<string, unknown> & {
        targetBlockId?: string;
      };
    };
    const threadContent = buildNfmThreadMentionInlineContent(makePaletteThread({
      threadId: "thr-payload",
    })) as Array<{ type?: string; props?: { uuid?: string } } | string>;

    expect(pageRefBlock.type).toBe("pageRef");
    expect(pageRefBlock.props?.targetBlockId).toBe("page-2");
    expect(Object.hasOwn(pageRefBlock.props ?? {}, "displayHint")).toBe(false);
    expect(Object.hasOwn(pageRefBlock.props ?? {}, "sourceProjectId")).toBe(false);
    expect(Object.hasOwn(pageRefBlock.props ?? {}, "pageId")).toBe(false);
    const firstThreadContent = threadContent[0];
    expect(typeof firstThreadContent === "string").toBe(false);
    if (typeof firstThreadContent === "string") return;
    expect(firstThreadContent?.type).toBe("threadMention");
    expect(firstThreadContent?.props?.uuid).toBe("thr-payload");
    expect(threadContent[1]).toBe(" ");
  });

  test("mention suggestion mapping groups current-project chats and Pages first", () => {
    const items = buildNfmMentionSuggestionItems({
      editor: {},
      threadResults: [
        makePaletteThread({
          threadId: "other-thread",
          id: "thread:other-thread",
          title: "Other project thread",
          projectId: "project-2",
          projectName: "Beta",
          inActiveProject: false,
        }),
        makePaletteThread({
          threadId: "active-thread",
          id: "thread:active-thread",
          title: "Current project thread",
          inActiveProject: true,
        }),
        makePaletteThread({
          threadId: "projectless-thread",
          id: "thread:projectless-thread",
          title: "Projectless thread",
          projectId: null,
          projectName: null,
          projectless: true,
          inActiveProject: false,
        }),
      ],
      pageResults: [
        makePalettePage({
          projectId: "project-2",
          projectName: "Beta",
          page: makePage({ id: "other-page", title: "Other project page" }),
          inActiveProject: false,
        }),
        makePalettePage({
          page: makePage({ id: "active-page", title: "Current project page" }),
          inActiveProject: true,
        }),
      ],
    });

    expect(items.length).toBe(7);
    expect(items[0]?.title).toBe("Current project thread");
    expect(items[0]?.group).toBe("Current project");
    expect(items[1]?.title).toBe("Current project page");
    expect(items[1]?.group).toBe("Current project");
    expect(items[2]?.title).toBe("Today");
    expect(items[2]?.group).toBe("Dates");
    expect(items[3]?.title).toBe("Now");
    expect(items[3]?.group).toBe("Dates");
    expect(items[4]?.title).toBe("Other project thread");
    expect(items[4]?.group).toBe("Chats");
    expect(items[5]?.title).toBe("Projectless thread");
    expect(items[5]?.group).toBe("Chats");
    expect(items[6]?.title).toBe("Other project page");
    expect(items[6]?.group).toBe("Pages");
  });

  test("mention suggestion mapping preserves search-preview-only matches without substring filtering", () => {
    const items = buildNfmMentionSuggestionItems({
      editor: {},
      threadResults: [makePaletteThread({
        title: "Unrelated visible title",
        searchPreview: {
          source: "content",
          excerpt: "Only transcript content matched the query.",
          segments: [{ text: "Only transcript content matched the query.", highlight: true }],
        },
      })],
      pageResults: [makePalettePage({
        page: makePage({
          title: "Unrelated page title",
        }),
        searchPreview: {
          excerpt: "Only page description matched the query.",
          segments: [{ text: "Only page description matched the query.", highlight: true }],
        },
      })],
    });

    expect(items.length).toBe(4);
    expect(items[0]?.group).toBe("Current project");
    expect(items[0]?.subtext?.includes("Only transcript content")).toBe(true);
    expect(items[1]?.group).toBe("Current project");
    expect(items[1]?.subtext?.includes("Only page description")).toBe(true);
    expect(items[2]?.title).toBe("Today");
    expect(items[3]?.title).toBe("Now");
  });

  test("maps an app-server-only chat into a thread mention suggestion", () => {
    const items = buildNfmMentionSuggestionItems({
      editor: {},
      threadResults: [makePaletteThread({
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
      pageResults: [],
    });

    expect(items[0]).toMatchObject({
      title: "Historical mention target",
      group: "Current project",
    });
  });

  test("date mention suggestions are first for date-like queries and insert inline content", () => {
    const items = buildNfmMentionSuggestionItems({
      editor: {},
      query: "today",
      threadResults: [makePaletteThread({ title: "Current project thread" })],
      pageResults: [makePalettePage({ page: makePage({ title: "Current project page" }) })],
    });

    expect(items.length > 0).toBe(true);
    expect(items[0]?.title).toBe("Today");
    expect(items[0]?.group).toBe("Dates");
    expect(items[1]?.title).toBe("Remind today");
    expect(items[1]?.group).toBe("Reminders");
    expect(items[2]?.title).toBe("Current project thread");

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
    expect(selected?.textContent?.includes("/agent-config")).toBe(true);
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

  test("mention tooltips keep only compact context and search snippets", async () => {
    const rawCwd = "/tmp/project";
    const items = [
      buildNfmThreadMentionSuggestionItem({}, makePaletteThread({
        threadId: "raw-thread-id",
        cwd: rawCwd,
        title: "Searchable thread",
        searchPreview: {
          source: "content",
          excerpt: "Compact transcript snippet.",
          segments: [{ text: "Compact transcript snippet.", highlight: true }],
        },
      })),
      buildNfmPageMentionSuggestionItem({}, makePalettePage({
        page: makePage({ id: "raw-uuid-v7", title: "Searchable page" }),
        searchPreview: {
          excerpt: "Compact page snippet.",
          segments: [{ text: "Compact page snippet.", highlight: true }],
        },
      })),
    ];
    const view = renderSuggestionMenu(
      {
        items,
        loadingState: "loaded",
        selectedIndex: 0,
        onItemClick: () => undefined,
      },
    );

    expect(view.queryByText("Compact transcript snippet.")).toBe(null);

    const row = view.container.querySelector("#bn-suggestion-menu-item-0") as HTMLElement | null;
    expect(row).not.toBeNull();
    if (!row) return;

    await act(async () => {
      fireEvent.focus(row);
      await settleAsyncRender();
    });

    const tooltip = view.container.ownerDocument.body.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    const tooltipText = tooltip?.textContent ?? "";
    expect(tooltipText.includes("Alpha")).toBe(true);
    expect(tooltipText.includes("Compact transcript snippet.")).toBe(true);
    expect(tooltipText.includes("raw-thread-id")).toBe(false);
    expect(tooltipText.includes("raw-uuid-v7")).toBe(false);
    expect(tooltipText.includes(rawCwd)).toBe(false);
  });

  test("page mention tooltips suppress duplicate column and status labels", async () => {
    const item = buildNfmPageMentionSuggestionItem({}, makePalettePage({
      columnName: "Triage",
      page: makePage({ id: "draft-page", title: "Triage page", status: "triage" }),
    }));
    const view = renderSuggestionMenu(
      {
        items: [item],
        loadingState: "loaded",
        selectedIndex: 0,
        onItemClick: () => undefined,
      },
    );

    expect(item.subtext).toBe("Alpha / Triage");

    const row = view.container.querySelector("#bn-suggestion-menu-item-0") as HTMLElement | null;
    expect(row).not.toBeNull();
    if (!row) return;

    await act(async () => {
      fireEvent.focus(row);
      await settleAsyncRender();
    });

    const tooltip = view.container.ownerDocument.body.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    const tooltipText = tooltip?.textContent ?? "";
    expect(tooltipText.includes("Alpha / Triage")).toBe(true);
    expect(tooltipText.includes("Triage / draft")).toBe(false);
  });
});
