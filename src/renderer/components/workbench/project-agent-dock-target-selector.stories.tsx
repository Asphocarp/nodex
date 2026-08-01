import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ProjectAgentDockModel } from "@/lib/project-agent-dock-model";
import { ProjectAgentDockTargetSelector } from "./project-agent-dock-target-selector";

const chatRows: ProjectAgentDockModel["rows"] = [
  {
    id: "new",
    kind: "new",
    sessionId: null,
    label: "New chat",
    preview: null,
    selected: false,
    attention: "none",
    indicator: "idle",
  },
  {
    id: "session:running",
    kind: "session",
    sessionId: "running",
    label: "Refine the project board",
    preview: "Updating the priority field and regrouping cards",
    selected: true,
    attention: "activity",
    indicator: "running",
  },
  {
    id: "session:request",
    kind: "session",
    sessionId: "request",
    label: "Prepare release notes",
    preview: "Which release should this describe?",
    selected: false,
    attention: "request",
    indicator: "needs-attention",
  },
  {
    id: "session:unread",
    kind: "session",
    sessionId: "unread",
    label: "Review schema",
    preview: "Finished reviewing database relationships",
    selected: false,
    attention: "none",
    indicator: "unread",
  },
];

function SelectorStory({
  collectionMessage = null,
  hasMore = false,
  initialSelectedId = "session:running",
}: {
  readonly collectionMessage?: string | null;
  readonly hasMore?: boolean;
  readonly initialSelectedId?: string;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const rows = chatRows.map((row) => ({
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

export const RunningChat: Story = {};

export const UnreadChat: Story = {
  args: { initialSelectedId: "session:unread" },
};

export const NeedsAttention: Story = {
  args: { initialSelectedId: "session:request" },
};

export const Loading: Story = {
  args: { collectionMessage: "Loading chats…" },
};

export const ErrorAndPagination: Story = {
  args: {
    collectionMessage: "Couldn’t load chats",
    hasMore: true,
  },
};
