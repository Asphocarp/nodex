import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { NodexHoverCard, NodexHoverCardProvider } from "@/components/ui/hover-card";
import { NodexFloatingSurface } from "@/components/ui/floating-surface";
import type { Project } from "@/lib/types";
import type { ProjectAppearance } from "../../../shared/project-appearance";
import { ProjectHoverCard } from "./project-hover-card";

const PROJECT: Project = {
  id: "project-story",
  libraryId: "library-story",
  databaseId: "database-story",
  defaultDatabaseViewId: "view-story",
  lifecycle: "active",
  bindingRevision: 1,
  name: "nodex2",
  description: "",
  appearance: {
    color: "black",
    marker: { kind: "icon", icon: "folder" },
  },
  sources: [{ root: "/Users/asc/repo/nodex2", order: 0 }],
  primaryWorkspaceRoot: "/Users/asc/repo/nodex2",
  pinned: false,
  pinnedOrder: null,
  created: new Date("2026-07-01T00:00:00.000Z"),
  updated: new Date("2026-07-27T00:00:00.000Z"),
};

function HoverCardStory({
  project = PROJECT,
  activity,
  appearancePending = false,
  markerPickerOpen = false,
  missingRepository = false,
}: {
  project?: Project;
  activity?:
    | {
        projectId: string;
        taskCount: number;
        waitingCount: number;
        unreadCount: number;
        activeCount: number;
      }
    | null
    | undefined;
  appearancePending?: boolean;
  markerPickerOpen?: boolean;
  missingRepository?: boolean;
}) {
  const [appearance, setAppearance] = useState<ProjectAppearance>(project.appearance);
  const [pinned, setPinned] = useState(project.pinned);
  const resolvedActivity = useMemo(
    () =>
      activity === undefined
        ? {
            projectId: project.id,
            taskCount: 66,
            waitingCount: 0,
            unreadCount: 0,
            activeCount: 1,
          }
        : activity,
    [activity, project.id],
  );

  return (
    <div className="min-h-screen bg-token-main-surface-primary p-16 text-token-foreground">
      <NodexFloatingSurface>
        <ProjectHoverCard
          project={{ ...project, appearance, pinned }}
          appearance={appearance}
          activity={resolvedActivity}
          appearancePending={appearancePending}
          repositoryIdentity={
            missingRepository
              ? null
              : {
                  repositoryRoot: "/Users/asc/repo/nodex2",
                  ownerRepo: { owner: "junyudev", repo: "nodex" },
                }
          }
          pathContext={{ homeDirectory: "/Users/asc", separator: "/" }}
          markerPickerOpen={markerPickerOpen}
          onAppearanceChange={setAppearance}
          onRename={async () => undefined}
          onSetPinned={async (nextPinned) => setPinned(nextPinned)}
          onOpenSource={() => undefined}
          onEdit={() => undefined}
        />
      </NodexFloatingSurface>
    </div>
  );
}

function FloatingHoverCardStory() {
  const [appearance, setAppearance] = useState<ProjectAppearance>(PROJECT.appearance);
  return (
    <NodexHoverCardProvider>
      <div className="min-h-screen bg-token-main-surface-primary p-4 text-token-foreground">
        <NodexHoverCard
          ariaLabel="Project details for nodex2"
          defaultOpen
          hoverCardContent={
            <ProjectHoverCard
              project={{ ...PROJECT, appearance }}
              activity={{
                projectId: PROJECT.id,
                taskCount: 66,
                waitingCount: 2,
                unreadCount: 3,
                activeCount: 1,
              }}
              repositoryIdentity={{
                repositoryRoot: "/Users/asc/repo/nodex2",
                ownerRepo: { owner: "junyudev", repo: "nodex" },
              }}
              pathContext={{ homeDirectory: "/Users/asc", separator: "/" }}
              appearance={appearance}
              onAppearanceChange={setAppearance}
              onRename={async () => undefined}
              onOpenSource={() => undefined}
              onEdit={() => undefined}
            />
          }
        >
          <button type="button" className="rounded-lg px-2 py-1">
            nodex2
          </button>
        </NodexHoverCard>
      </div>
    </NodexHoverCardProvider>
  );
}

const meta = {
  title: "Workbench/Project Hover Card",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultOpen: Story = {
  render: () => <HoverCardStory />,
};

export const NestedMarkerPickerOpen: Story = {
  render: () => <HoverCardStory markerPickerOpen />,
};

export const MultipleSourcesAndAttention: Story = {
  render: () => (
    <HoverCardStory
      activity={{
        projectId: PROJECT.id,
        taskCount: 66,
        waitingCount: 2,
        unreadCount: 3,
        activeCount: 1,
      }}
      project={{
        ...PROJECT,
        pinned: true,
        sources: [
          { root: "/Users/asc/repo/nodex2", order: 0 },
          { root: "/Users/asc/repo/devtools-codex", order: 1 },
          { root: "/Users/asc/Documents/design-notes", order: 2 },
        ],
      }}
    />
  ),
};

export const LoadingAndReconciliation: Story = {
  render: () => <HoverCardStory activity={undefined} appearancePending markerPickerOpen />,
};

export const NarrowViewportWithOuterSurface: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  render: () => <FloatingHoverCardStory />,
};

export const EmojiAndLongContent: Story = {
  render: () => (
    <HoverCardStory
      missingRepository
      project={{
        ...PROJECT,
        name: "A deliberately long Project name that must remain bounded",
        appearance: {
          color: "pink",
          marker: { kind: "emoji", emoji: "🪴" },
        },
        sources: [
          {
            root: "/Users/asc/Documents/a/very/long/source/path/that/must/wrap/without/widening/the/card",
            order: 0,
          },
        ],
      }}
    />
  ),
};

export const DarkTheme: Story = {
  decorators: [
    (Story) => (
      <div className="dark electron-dark">
        <Story />
      </div>
    ),
  ],
  render: () => <HoverCardStory />,
};
