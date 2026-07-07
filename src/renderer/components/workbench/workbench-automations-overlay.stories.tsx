import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { CodexScheduledAutomation } from "@/lib/types";
import { NODEX_QUERY_DEFAULT_OPTIONS } from "@/lib/query-client";
import { WorkbenchAutomationsRouteShell } from "./workbench-automations-overlay";
import { buildAutomationsPath } from "./workbench-automations-routes";

const AUTOMATIONS: CodexScheduledAutomation[] = [
  {
    id: "automation-standup",
    kind: "heartbeat",
    status: "ACTIVE",
    targetThreadId: "thread-standup",
    name: "Daily engineering standup",
    rrule: "FREQ=DAILY",
    nextRunAt: new Date("2026-07-09T09:00:00.000Z").getTime(),
    createdAt: new Date("2026-07-01T09:00:00.000Z").getTime(),
    updatedAt: new Date("2026-07-08T09:00:00.000Z").getTime(),
  },
  {
    id: "automation-review",
    kind: "heartbeat",
    status: "ACTIVE",
    targetThreadId: "thread-review",
    name: "Weekly review sweep",
    rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    nextRunAt: new Date("2026-07-10T16:00:00.000Z").getTime(),
    createdAt: new Date("2026-07-02T16:00:00.000Z").getTime(),
    updatedAt: new Date("2026-07-08T16:00:00.000Z").getTime(),
  },
  {
    id: "automation-paused",
    kind: "heartbeat",
    status: "PAUSED",
    targetThreadId: "thread-paused",
    name: "Paused inbox triage",
    rrule: "FREQ=DAILY;INTERVAL=2",
    nextRunAt: null,
    createdAt: new Date("2026-07-03T12:00:00.000Z").getTime(),
    updatedAt: new Date("2026-07-08T12:00:00.000Z").getTime(),
  },
];

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

function upsertStoryAutomation(
  automations: CodexScheduledAutomation[],
  automation: CodexScheduledAutomation,
): CodexScheduledAutomation[] {
  const didReplace = automations.some((item) => item.id === automation.id);
  if (didReplace) {
    return automations.map((item) => (item.id === automation.id ? automation : item));
  }
  return [...automations, automation];
}

function installAutomationsStoryApi({
  automations,
  setAutomations,
}: {
  automations: CodexScheduledAutomation[];
  setAutomations: (automations: CodexScheduledAutomation[]) => void;
}) {
  if (typeof window === "undefined") return;
  window.api = {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel === "codex:scheduled-automations:list") return automations;
      if (channel === "codex:scheduled-automations:upsert") {
        const input = args[0] as CodexScheduledAutomation;
        const saved = {
          ...input,
          createdAt: input.createdAt ?? Date.now(),
          updatedAt: input.updatedAt ?? Date.now(),
        } satisfies CodexScheduledAutomation;
        setAutomations(upsertStoryAutomation(automations, saved));
        return saved;
      }
      if (channel === "codex:scheduled-automations:delete") {
        const automationId = String(args[0]);
        setAutomations(automations.filter((automation) => automation.id !== automationId));
        return true;
      }
      return null;
    },
    on: () => () => undefined,
  } as typeof window.api;
}

function AutomationsRouteShellStory({
  initialPath,
  automations = AUTOMATIONS,
}: {
  initialPath: string;
  automations?: CodexScheduledAutomation[];
}) {
  const [automationState, setAutomationState] = useState(automations);
  installAutomationsStoryApi({
    automations: automationState,
    setAutomations: setAutomationState,
  });
  const [path, setPath] = useState(initialPath);
  const queryClient = useMemo(createStoryQueryClient, []);
  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen w-screen bg-token-main-surface-primary">
        <WorkbenchAutomationsRouteShell
          path={path}
          onPathChange={setPath}
          onBackToApp={() => setPath(initialPath)}
        />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Workbench/AutomationsRouteShell",
  component: AutomationsRouteShellStory,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AutomationsRouteShellStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SelectedTask: Story = {
  args: {
    initialPath: buildAutomationsPath({ automationId: "automation-standup" }),
  },
};

export const EmptyTasks: Story = {
  args: {
    initialPath: buildAutomationsPath(),
    automations: [],
  },
};

export const MissingTask: Story = {
  args: {
    initialPath: buildAutomationsPath({ automationId: "automation-missing" }),
  },
};
