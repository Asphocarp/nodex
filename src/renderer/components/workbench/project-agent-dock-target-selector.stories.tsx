import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ProjectAgentDockModel } from "@/lib/project-agent-dock-model";
import { ProjectAgentDockTargetSelector } from "./project-agent-dock-target-selector";

const taskRows: ProjectAgentDockModel["rows"] = [
  {
    id: "new",
    kind: "new",
    sessionId: null,
    label: "New task",
    statusLabel: "Draft",
    preview: null,
    selected: false,
    attention: "none",
  },
  {
    id: "session:running",
    kind: "session",
    sessionId: "running",
    label: "Refine the project board",
    statusLabel: "Running",
    preview: "Updating the priority field and regrouping cards",
    selected: true,
    attention: "activity",
  },
  {
    id: "session:request",
    kind: "session",
    sessionId: "request",
    label: "Prepare release notes",
    statusLabel: "Needs input",
    preview: "Which release should this describe?",
    selected: false,
    attention: "request",
  },
  {
    id: "session:idle",
    kind: "session",
    sessionId: "idle",
    label: "Review schema",
    statusLabel: "Idle",
    preview: "Finished reviewing database relationships",
    selected: false,
    attention: "none",
  },
];

function SelectorStory({
  collectionMessage = null,
  hasMore = false,
}: {
  readonly collectionMessage?: string | null;
  readonly hasMore?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("session:running");
  const rows = taskRows.map((row) => ({
    ...row,
    selected: row.id === selectedId,
  }));
  const trigger = rows.find((row) => row.selected) ?? rows[0]!;
  return (
    <div className="flex min-h-72 items-end bg-token-main-surface-primary p-8">
      <ProjectAgentDockTargetSelector
        model={{
          trigger,
          rows,
          canSend: true,
          collectionMessage,
          hasMore,
        }}
        query={query}
        onQueryChange={setQuery}
        onSelect={(row) => setSelectedId(row.id)}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
      />
    </div>
  );
}

const meta = {
  title: "Workbench/Project Agent Dock Target Selector",
  component: SelectorStory,
} satisfies Meta<typeof SelectorStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const RunningTask: Story = {};

export const Loading: Story = {
  args: { collectionMessage: "Loading tasks…" },
};

export const ErrorAndPagination: Story = {
  args: {
    collectionMessage: "Couldn’t load tasks",
    hasMore: true,
  },
};
