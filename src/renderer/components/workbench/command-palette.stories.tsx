import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import type {
  CommandMenuMode,
  CommandPalettePage,
  CommandPaletteCommand,
  CommandPaletteThread,
} from "@/lib/command-palette";
import { createCommandPalettePageSearchIndex } from "@/lib/command-palette-page-search";
import { createCommandPaletteThreadSearchIndex } from "@/lib/command-palette-thread-search";
import { buildCommandPaletteCommands } from "@/lib/command-palette-commands";
import type { DatabasePageSummary } from "@/lib/types";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import { CommandPaletteSurface } from "./command-palette-surface";

function makeStoryPage(overrides: Partial<DatabasePageSummary> = {}): DatabasePageSummary {
  const title = overrides.title ?? "Command palette shell refresh";
  return {
    id: overrides.id ?? "palette-page",
    status: overrides.status ?? "build",
    title,
    richTitle: overrides.richTitle ?? plainTextToPortableRichText(title),
    tags: overrides.tags ?? ["palette", "shell"],
    archived: false,
    created: new Date("2026-06-20T00:00:00.000Z"),
    order: 0,
    revision: 1,
    descriptionPreview: overrides.descriptionPreview ?? "Replace legacy stage commands with session panel tab actions.",
    descriptionLength: overrides.descriptionLength ?? 84,
    hasDescription: true,
    priority: overrides.priority,
    assignee: overrides.assignee,
    ...overrides,
  };
}

function makePalettePage(
  overrides: Partial<Omit<CommandPalettePage, "page">> & { page?: Partial<DatabasePageSummary> } = {},
): CommandPalettePage {
  const page = makeStoryPage(overrides.page ?? {});
  const projectId = overrides.projectId ?? "nodex";
  return {
    kind: "page",
    id: overrides.id ?? page.id,
    projectId,
    projectName: overrides.projectName ?? "Nodex",
    projectIcon: overrides.projectIcon ?? "",
    columnName: overrides.columnName ?? "Build",
    page,
    inActiveProject: overrides.inActiveProject ?? true,
    recentIndex: overrides.recentIndex ?? null,
    boardIndex: overrides.boardIndex ?? 0,
    searchPreview: overrides.searchPreview ?? null,
    searchDecorations: overrides.searchDecorations ?? null,
  };
}

function makePaletteThread(overrides: Partial<CommandPaletteThread> = {}): CommandPaletteThread {
  return {
    kind: "thread",
    id: overrides.id ?? "thread:thr-palette-search",
    threadId: overrides.threadId ?? "thr-palette-search",
    sessionId: overrides.sessionId === undefined ? "session-palette-search" : overrides.sessionId,
    projectId: overrides.projectId === undefined ? "nodex" : overrides.projectId,
    projectName: overrides.projectName === undefined ? "Nodex" : overrides.projectName,
    title: overrides.title ?? "Command palette thread search",
    preview: overrides.preview ?? "Investigate fuzzy thread search and content snippets in the launcher.",
    cwd: overrides.cwd ?? "/Users/asc/nodex",
    projectless: overrides.projectless ?? false,
    pinned: overrides.pinned ?? false,
    pinnedOrder: overrides.pinnedOrder ?? null,
    statusType: overrides.statusType ?? "notLoaded",
    statusActiveFlags: overrides.statusActiveFlags ?? [],
    createdAt: overrides.createdAt ?? 1_781_990_400,
    updatedAt: overrides.updatedAt ?? 1_781_990_400,
    linkedAt: overrides.linkedAt ?? "2026-06-20T00:00:00.000Z",
    inActiveProject: overrides.inActiveProject ?? true,
    searchPreview: overrides.searchPreview,
    searchDecorations: overrides.searchDecorations,
  };
}

function CommandPaletteStory({
  initialQuery,
  mode,
  includeThreads = false,
}: {
  initialQuery: string;
  mode: CommandMenuMode;
  includeThreads?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const pages = useMemo<CommandPalettePage[]>(() => [
    makePalettePage(),
    makePalettePage({
      id: "side-panel-db-view",
      projectId: "codex",
      projectName: "Codex app",
      columnName: "Review",
      boardIndex: 1,
      page: {
        id: "side-panel-db-view",
        title: "DB View command opens as a panel tab",
        tags: ["db", "tabs"],
        status: "review",
        priority: "p1-high",
        descriptionPreview: "Keep project database work in the current session shell instead of a global view switch.",
      },
    }),
  ], []);
  const commands = useMemo<CommandPaletteCommand[]>(() => [
    ...buildCommandPaletteCommands({
      canGoBack: false,
      canGoForward: true,
      canStartNewChat: true,
      hasActiveSession: true,
      activeSessionPinned: true,
      hasAttachedThread: false,
      canOpenSessionInNewWindow: false,
      isMac: true,
      showMockCommands: true,
    }),
    {
      kind: "command",
      id: "storybook-long-command",
      group: "App",
      title: "Open a very long command title that still needs to truncate cleanly",
      subtitle: "Story-only row for scanning title overflow, shortcut alignment, and disabled styling",
      keywords: ["long", "overflow", "disabled"],
      shortcut: "⌘⌥⇧L",
      disabled: true,
      priority: 100,
    },
  ], []);
  const threads = useMemo<CommandPaletteThread[]>(() => includeThreads ? [
    makePaletteThread(),
    makePaletteThread({
      id: "thread:thr-content-snippet",
      threadId: "thr-content-snippet",
      sessionId: "session-content-snippet",
      projectId: "codex",
      projectName: "Codex app",
      title: "Thread transcript search",
      preview: "Review how local indexed history search returns bounded snippets.",
      cwd: "/Users/asc/codex-app",
      inActiveProject: false,
      searchPreview: {
        source: "content",
        excerpt: "The launcher should surface transcript matches from previous assistant turns without loading every thread.",
        segments: [
          { text: "The launcher should surface ", highlight: false },
          { text: "transcript matches", highlight: true },
          { text: " from previous assistant turns without loading every thread.", highlight: false },
        ],
      },
    }),
    makePaletteThread({
      id: "thread:thr-projectless",
      threadId: "thr-projectless",
      sessionId: null,
      projectId: null,
      projectName: null,
      projectless: true,
      title: "Projectless packaging notes",
      preview: "A sidebar chat discovered outside any project source root.",
      cwd: "/tmp/codex-scratch",
      inActiveProject: false,
    }),
  ] : [], [includeThreads]);
  const pageSearchIndex = useMemo(() => createCommandPalettePageSearchIndex(pages), [pages]);
  const threadSearchIndex = useMemo(() => createCommandPaletteThreadSearchIndex(threads), [threads]);

  return (
    <div className="min-h-screen bg-token-main-surface-primary px-8 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <CommandPaletteSurface
          open={open}
          openTriggerTick={open ? 1 : 0}
          mode={mode}
          initialQuery={initialQuery}
          commands={commands}
          pages={pages}
          threads={threads}
          pageSearchIndex={pageSearchIndex}
          threadSearchIndex={threadSearchIndex}
          loading={false}
          pagesLoading={false}
          chatsLoading={false}
          onChangeMode={() => undefined}
          onRequestClose={() => setOpen(false)}
          onExecute={() => setOpen(false)}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Workbench/Command Palette",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const RootCommands: Story = {
  render: () => <CommandPaletteStory mode="root" initialQuery="" />,
};

export const PageSearch: Story = {
  render: () => <CommandPaletteStory mode="pages" initialQuery="palette" />,
};

export const ChatSearch: Story = {
  render: () => <CommandPaletteStory mode="chats" initialQuery="thread search" includeThreads />,
};

export const ChatContentSnippet: Story = {
  render: () => <CommandPaletteStory mode="chats" initialQuery="transcript matches" includeThreads />,
};

export const FilesMock: Story = {
  render: () => <CommandPaletteStory mode="files" initialQuery="" />,
};
