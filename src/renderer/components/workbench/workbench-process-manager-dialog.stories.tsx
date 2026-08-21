import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ThreadBackgroundTerminal } from "@nodex/codex-app-server-protocol/v2";
import { NODEX_QUERY_DEFAULT_OPTIONS } from "@/lib/query-client";
import {
  WorkbenchProcessManagerDialog,
  type WorkbenchProcessManagerControl,
} from "./workbench-process-manager-dialog";
import type { CodexBackgroundProcessRow } from "../../../shared/types";

const THREADS = [
  { threadId: "thread-dev-server", title: "Local dev server parity" },
  { threadId: "thread-docs", title: "Docs preview" },
];

const TERMINALS: Record<string, ThreadBackgroundTerminal[]> = {
  "thread-dev-server": [
    {
      itemId: "item-vite",
      processId: "process-vite",
      command: "bun run dev:remote-debug",
      cwd: "/Users/asc/repo/nodex",
      osPid: 4312,
      cpuPercent: 12.5,
      rssKb: 1536n,
    },
    {
      itemId: "item-server",
      processId: "process-server",
      command: "bun run server",
      cwd: "/Users/asc/repo/nodex",
      osPid: 4319,
      cpuPercent: 4.1,
      rssKb: 2_097_152n,
    },
  ],
  "thread-docs": [
    {
      itemId: "item-docs",
      processId: "process-docs",
      command: "python -m http.server 8080",
      cwd: "/Users/asc/repo/nodex/docs",
      osPid: null,
      cpuPercent: 0.8,
      rssKb: 512n,
    },
  ],
};

function rowFromTerminal(
  threadId: string,
  threadTitle: string,
  terminal: ThreadBackgroundTerminal,
): CodexBackgroundProcessRow {
  return {
    id: `${threadId}:${terminal.itemId}`,
    threadId,
    threadTitle,
    itemId: terminal.itemId,
    turnId: `turn-${terminal.itemId}`,
    command: terminal.command,
    cwd: terminal.cwd,
    processId: terminal.processId,
    osPid: terminal.osPid,
    terminalSessionId: null,
    source: "app-server",
    startedAtMs: Date.now() - 30_000,
    updatedAtMs: Date.now(),
    status: "running",
    terminal,
    terminalSession: null,
  };
}

const PROCESS_ROWS: Record<string, CodexBackgroundProcessRow[]> = {
  "thread-dev-server": [
    ...TERMINALS["thread-dev-server"].map((terminal) =>
      rowFromTerminal("thread-dev-server", "Local dev server parity", terminal),
    ),
    {
      id: "thread-dev-server:item-last",
      threadId: "thread-dev-server",
      threadTitle: "Local dev server parity",
      itemId: "item-last",
      turnId: "turn-last",
      command: "bun run preview",
      cwd: "/Users/asc/repo/nodex",
      processId: "process-last",
      osPid: null,
      terminalSessionId: null,
      source: "app-server",
      startedAtMs: Date.now() - 120_000,
      updatedAtMs: Date.now() - 60_000,
      status: "not-found",
      terminal: null,
      terminalSession: null,
    },
  ],
  "thread-docs": TERMINALS["thread-docs"].map((terminal) =>
    rowFromTerminal("thread-docs", "Docs preview", terminal),
  ),
};

function createStoryQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        ...NODEX_QUERY_DEFAULT_OPTIONS.queries,
        retry: false,
      },
      mutations: {
        ...NODEX_QUERY_DEFAULT_OPTIONS.mutations,
        retry: false,
      },
    },
  });
}

function ProcessManagerStory({ empty = false }: { empty?: boolean }) {
  const [open, setOpen] = useState(true);
  const queryClient = useMemo(createStoryQueryClient, []);
  const control = useMemo<WorkbenchProcessManagerControl>(
    () => ({
      listBackgroundProcesses: async (threadId) => (empty ? [] : (PROCESS_ROWS[threadId] ?? [])),
      runBackgroundProcess: async () => [],
      stopBackgroundProcess: async () => true,
      terminateBackgroundTerminal: async () => true,
    }),
    [empty],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen w-screen bg-token-main-surface-primary text-token-foreground">
        <WorkbenchProcessManagerDialog
          open={open}
          activeThreadId="thread-dev-server"
          threads={THREADS}
          control={control}
          onOpenChange={setOpen}
          onOpenThread={() => undefined}
        />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Workbench/Process Manager Dialog",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithProcesses: Story = {
  render: () => <ProcessManagerStory />,
};

export const Empty: Story = {
  render: () => <ProcessManagerStory empty />,
};
