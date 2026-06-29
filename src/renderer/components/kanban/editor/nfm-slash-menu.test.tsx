import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  buildNfmCardMentionBlock,
  buildNfmCardMentionSuggestionItem,
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
import type { CommandPaletteCard, CommandPaletteThread } from "@/lib/command-palette";
import type { CardSummary, CodexThreadSummary, Project } from "@/lib/types";

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

function makeCard(overrides: Partial<CardSummary> = {}): CardSummary {
  const descriptionPreview = overrides.descriptionPreview ?? "Add shared mention search.";
  return {
    id: overrides.id ?? "card-1",
    title: overrides.title ?? "Mention search card",
    descriptionPreview,
    descriptionLength: overrides.descriptionLength ?? descriptionPreview.length,
    hasDescription: overrides.hasDescription ?? descriptionPreview.length > 0,
    status: overrides.status ?? "in_progress",
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
    agentStatus: overrides.agentStatus,
    agentBlocked: overrides.agentBlocked ?? false,
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

function makePaletteCard(overrides: Partial<CommandPaletteCard> = {}): CommandPaletteCard {
  const card = overrides.card ?? makeCard();
  return {
    kind: "card",
    id: overrides.id ?? `${overrides.projectId ?? "project-1"}:${card.id}`,
    projectId: overrides.projectId ?? "project-1",
    projectName: overrides.projectName ?? "Alpha",
    projectIcon: overrides.projectIcon ?? "",
    columnName: overrides.columnName ?? "Doing",
    card,
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
    projectless: overrides.projectless ?? false,
    pinned: overrides.pinned ?? false,
    pinnedOrder: overrides.pinnedOrder ?? null,
    statusType: overrides.statusType ?? "notLoaded",
    statusActiveFlags: overrides.statusActiveFlags ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
    linkedAt: overrides.linkedAt ?? "2026-06-20T00:00:00.000Z",
    inActiveProject: overrides.inActiveProject ?? true,
    searchPreview: overrides.searchPreview,
    searchDecorations: overrides.searchDecorations,
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

  test("mention suggestion builders expose command-palette snippets in compact row tooltips", () => {
    const editor = {};
    const cardItem = buildNfmCardMentionSuggestionItem(editor, makePaletteCard({
      card: makeCard({ id: "card-snippet", title: "Searchable card", status: "backlog" }),
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

    expect(cardItem.group).toBe("Cards");
    expect(cardItem.subtext?.includes("Description-only vector clock")).toBeTrue();
    expect(cardItem.subtext?.includes("card-snippet")).toBeFalse();
    expect(resolveNfmSuggestionHint(cardItem)).toBe(null);
    expect(threadItem.group).toBe("Chats");
    expect(threadItem.subtext?.includes("Transcript-only approval heuristic")).toBeTrue();
    expect(threadItem.subtext?.includes("thr-snippet")).toBeFalse();
    expect(resolveNfmSuggestionHint(threadItem)).toBe(null);
  });

  test("mention payload helpers preserve cardRef and threadMention storage shapes", () => {
    const cardBlock = buildNfmCardMentionBlock(makePaletteCard({
      projectId: "project-2",
      card: makeCard({ id: "card-2" }),
    })) as { type?: string; props?: { sourceProjectId?: string; cardId?: string } };
    const threadContent = buildNfmThreadMentionInlineContent(makePaletteThread({
      threadId: "thr-payload",
    })) as Array<{ type?: string; props?: { uuid?: string } } | string>;

    expect(cardBlock.type).toBe("cardRef");
    expect(cardBlock.props?.sourceProjectId).toBe("project-2");
    expect(cardBlock.props?.cardId).toBe("card-2");
    const firstThreadContent = threadContent[0];
    expect(typeof firstThreadContent === "string").toBeFalse();
    if (typeof firstThreadContent === "string") return;
    expect(firstThreadContent?.type).toBe("threadMention");
    expect(firstThreadContent?.props?.uuid).toBe("thr-payload");
    expect(threadContent[1]).toBe(" ");
  });

  test("mention suggestion mapping groups current-project chats and cards first", () => {
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
      cardResults: [
        makePaletteCard({
          projectId: "project-2",
          projectName: "Beta",
          card: makeCard({ id: "other-card", title: "Other project card" }),
          inActiveProject: false,
        }),
        makePaletteCard({
          card: makeCard({ id: "active-card", title: "Current project card" }),
          inActiveProject: true,
        }),
      ],
    });

    expect(items.length).toBe(7);
    expect(items[0]?.title).toBe("Current project thread");
    expect(items[0]?.group).toBe("Current project");
    expect(items[1]?.title).toBe("Current project card");
    expect(items[1]?.group).toBe("Current project");
    expect(items[2]?.title).toBe("Today");
    expect(items[2]?.group).toBe("Dates");
    expect(items[3]?.title).toBe("Now");
    expect(items[3]?.group).toBe("Dates");
    expect(items[4]?.title).toBe("Other project thread");
    expect(items[4]?.group).toBe("Chats");
    expect(items[5]?.title).toBe("Projectless thread");
    expect(items[5]?.group).toBe("Chats");
    expect(items[6]?.title).toBe("Other project card");
    expect(items[6]?.group).toBe("Cards");
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
      cardResults: [makePaletteCard({
        card: makeCard({
          title: "Unrelated card title",
        }),
        searchPreview: {
          excerpt: "Only card description matched the query.",
          segments: [{ text: "Only card description matched the query.", highlight: true }],
        },
      })],
    });

    expect(items.length).toBe(4);
    expect(items[0]?.group).toBe("Current project");
    expect(items[0]?.subtext?.includes("Only transcript content")).toBeTrue();
    expect(items[1]?.group).toBe("Current project");
    expect(items[1]?.subtext?.includes("Only card description")).toBeTrue();
    expect(items[2]?.title).toBe("Today");
    expect(items[3]?.title).toBe("Now");
  });

  test("date mention suggestions are first for date-like queries and insert inline content", () => {
    const items = buildNfmMentionSuggestionItems({
      editor: {},
      query: "today",
      threadResults: [makePaletteThread({ title: "Current project thread" })],
      cardResults: [makePaletteCard({ card: makeCard({ title: "Current project card" }) })],
    });

    expect(items.length > 0).toBeTrue();
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
    expect(typeof first === "string").toBeFalse();
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
      buildNfmCardMentionSuggestionItem({}, makePaletteCard({
        card: makeCard({ id: "raw-card-id", title: "Searchable card" }),
        searchPreview: {
          excerpt: "Compact card snippet.",
          segments: [{ text: "Compact card snippet.", highlight: true }],
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
    expect(tooltipText.includes("Alpha")).toBeTrue();
    expect(tooltipText.includes("Compact transcript snippet.")).toBeTrue();
    expect(tooltipText.includes("raw-thread-id")).toBeFalse();
    expect(tooltipText.includes("raw-card-id")).toBeFalse();
    expect(tooltipText.includes(rawCwd)).toBeFalse();
  });

  test("card mention tooltips suppress duplicate column and status labels", async () => {
    const item = buildNfmCardMentionSuggestionItem({}, makePaletteCard({
      columnName: "Draft",
      card: makeCard({ id: "draft-card", title: "Draft card", status: "draft" }),
    }));
    const view = renderSuggestionMenu(
      {
        items: [item],
        loadingState: "loaded",
        selectedIndex: 0,
        onItemClick: () => undefined,
      },
    );

    expect(item.subtext).toBe("Alpha / Draft");

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
    expect(tooltipText.includes("Alpha / Draft")).toBeTrue();
    expect(tooltipText.includes("Draft / draft")).toBeFalse();
  });
});
