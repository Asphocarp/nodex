import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { BoardSummary, CardSummary, Project } from "@/lib/types";
import type { SendBlocksMode } from "./nfm-drag-handle-menu";
import { SendBlocksDialogSurface } from "./send-blocks-dialog";

const STORY_DATE = new Date("2026-01-01T00:00:00.000Z");

function makeProject(id: string, name: string, icon?: string): Project {
  return {
    id,
    name,
    description: "",
    icon,
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: STORY_DATE,
    updated: STORY_DATE,
  };
}

function makeCard(id: string, title: string, status: CardSummary["status"], order: number): CardSummary {
  return {
    id,
    status,
    archived: false,
    title,
    tags: [],
    agentBlocked: false,
    created: STORY_DATE,
    order,
    revision: 1,
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
  };
}

const PROJECTS = [
  makeProject("default", "Default", "🔥"),
  makeProject("renderer-parity", "Renderer parity with an intentionally long project label", "🧭"),
];

const DEFAULT_BOARD: BoardSummary = {
  columns: [
    {
      id: "draft",
      name: "Draft",
      cards: [
        makeCard("source-card", "Source card hidden from append targets", "draft", 0),
        makeCard("nfm-dnd", "test-nfm-editor-dnd", "draft", 1),
        makeCard("queue", "queue", "draft", 2),
        makeCard("editor", "dig into editor", "draft", 3),
        makeCard(
          "long-title",
          "Long card title that must truncate instead of pushing the dialog footer outside the modal",
          "draft",
          4,
        ),
      ],
    },
    {
      id: "in_progress",
      name: "In Progress",
      cards: [
        makeCard("rich-selection", "Rich selection send workflow", "in_progress", 0),
        makeCard("card-stage", "Card Stage compact controls", "in_progress", 1),
      ],
    },
    {
      id: "done",
      name: "Done",
      cards: [
        makeCard("history", "History modal polish", "done", 0),
      ],
    },
  ],
};

const RENDERER_BOARD: BoardSummary = {
  columns: [
    {
      id: "backlog",
      name: "Backlog with a long label",
      cards: [
        makeCard("projection", "Projection pipeline cleanup", "backlog", 0),
        makeCard("request-lanes", "Request lanes and composer cards", "backlog", 1),
      ],
    },
  ],
};

const BOARD_MAP = new Map<string, BoardSummary>([
  ["default", DEFAULT_BOARD],
  ["renderer-parity", RENDERER_BOARD],
]);

interface SendBlocksDialogStoryProps {
  mode: SendBlocksMode;
  blockCount: number;
  narrow?: boolean;
  boardsLoading?: boolean;
  loadError?: string | null;
}

function SendBlocksDialogStory({
  mode,
  blockCount,
  narrow = false,
  boardsLoading = false,
  loadError = null,
}: SendBlocksDialogStoryProps) {
  const [open, setOpen] = useState(true);

  return (
    <div
      className={[
        "min-h-[620px] bg-token-editor-background p-6 text-token-foreground",
        narrow ? "w-[390px]" : "w-full",
      ].join(" ")}
    >
      <SendBlocksDialogSurface
        open={open}
        mode={mode}
        blockCount={blockCount}
        sourceProjectId="default"
        sourceCardId="source-card"
        projects={PROJECTS}
        projectsLoading={false}
        boardMap={BOARD_MAP}
        boardsLoading={boardsLoading}
        loadError={loadError}
        onOpenChange={setOpen}
        onAppendToCard={async () => setOpen(false)}
        onSendToProject={async () => setOpen(false)}
      />
    </div>
  );
}

const meta = {
  title: "Kanban/Editor/Move Blocks Dialog",
  component: SendBlocksDialogStory,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Dialog states for moving selected NFM blocks into another card or DB.",
      },
    },
  },
  args: {
    mode: "card",
    blockCount: 4,
    narrow: false,
    boardsLoading: false,
    loadError: null,
  },
} satisfies Meta<typeof SendBlocksDialogStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MoveToCard: Story = {};

export const MoveToCardNarrow: Story = {
  args: {
    narrow: true,
  },
};

export const MoveToDb: Story = {
  name: "Move to DB",
  args: {
    mode: "project",
    blockCount: 6,
  },
};

export const LoadingCards: Story = {
  args: {
    boardsLoading: true,
  },
};
