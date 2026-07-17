import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { BoardSummary, DatabasePageSummary, Project } from "@/lib/types";
import type { DatabaseContainerDescriptor } from "../../../shared/database-module";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import type { PanelDestination } from "./panel-destination-picker-model";
import { PanelDestinationPickerSurface } from "./panel-destination-picker";

const STORY_DATE = new Date("2026-01-01T00:00:00.000Z");

function makeProject(id: string, name: string, icon?: string): Project {
  return {
    id,
    libraryId: "library:test",
    databaseId: "database:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
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

function makeCard(id: string, title: string, status: DatabasePageSummary["status"], order: number): DatabasePageSummary {
  return {
    id,
    status,
    archived: false,
    title,
    richTitle: plainTextToPortableRichText(title),
    tags: [],
    created: STORY_DATE,
    order,
    revision: 1,
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
  };
}

const PROJECTS = [
  makeProject("nodex", "Nodex", "🧭"),
  makeProject("codex-readable", "Codex readable pack", "📦"),
];

const BOARD_MAP = new Map<string, BoardSummary>([
  [
    "nodex",
    {
      columns: [
        {
          id: "triage",
          name: "Triage",
          cards: [
            makeCard("panel-picker", "Panel picker polish", "triage", 0),
            makeCard("right-panel", "Right panel composer overlay", "triage", 1),
          ],
        },
        {
          id: "build",
          name: "Build",
          cards: [
            makeCard("page-stage", "Page Stage retained editor", "build", 0),
          ],
        },
      ],
    },
  ],
  [
    "codex-readable",
    {
      columns: [
        {
          id: "plan",
          name: "Plan",
          cards: [
            makeCard("research", "Move-to picker research notes", "plan", 0),
          ],
        },
      ],
    },
  ],
]);

const DATABASE_DESCRIPTOR_MAP = new Map<string, DatabaseContainerDescriptor>(
  PROJECTS.map((project) => {
    const databaseId = `database:${project.id}`;
    const dataSourceId = `data-source:${project.id}`;
    const makeView = (suffix: string, name: string, isDefault: boolean) => ({
      viewId: `view:${project.id}:${suffix}`,
      databaseId,
      dataSourceId,
      name,
      kind: "kanban" as const,
      config: {
        schemaKey: "nodex.database-view" as const,
        schemaVersion: 1 as const,
        filter: { kind: "group" as const, operator: "and" as const, children: [] },
        sort: [],
        group: null,
        display: { propertyIds: [], showTitle: true },
      },
      isDefault,
      revision: 1,
      rankKey: suffix,
      lifecycle: "active" as const,
      createdAt: STORY_DATE.toISOString(),
      updatedAt: STORY_DATE.toISOString(),
    });
    return [project.id, {
      database: {
        databaseId,
        libraryId: "library:test",
        name: "Tasks",
        lifecycle: "active",
        defaultViewId: `view:${project.id}:primary`,
        accessRevision: 1,
        metadataRevision: 1,
        createdAt: STORY_DATE.toISOString(),
        updatedAt: STORY_DATE.toISOString(),
      },
      dataSources: [{
        dataSourceId,
        libraryId: "library:test",
        homeDatabaseId: databaseId,
        name: "Pages",
        schemaKey: "nodex.page",
        schemaRevision: 1,
        lifecycle: "active",
        rankKey: "0",
        createdAt: STORY_DATE.toISOString(),
        updatedAt: STORY_DATE.toISOString(),
      }],
      views: project.id === "nodex"
        ? [
            makeView("primary", "Primary board", true),
            makeView("focused", "Focused work", false),
          ]
        : [makeView("primary", "Primary board", true)],
    }] as const;
  }),
);

function PanelDestinationPickerStory({
  loading = false,
  loadError = null,
  initialQuery = "",
  scope = "all",
  currentProjectId = "nodex",
}: {
  loading?: boolean;
  loadError?: string | null;
  initialQuery?: string;
  scope?: "all" | "db-only" | "page-only";
  currentProjectId?: string | null;
}) {
  const [accepted, setAccepted] = useState<PanelDestination | null>(null);

  return (
    <div className="flex min-h-screen items-start justify-center bg-token-main-surface-primary p-8 text-token-foreground">
      <div className="overflow-hidden rounded-xl bg-token-dropdown-background/90 ring-[0.5px] ring-token-border shadow-xl-spread backdrop-blur-sm">
        <PanelDestinationPickerSurface
          projects={PROJECTS}
          boardMap={loadError ? new Map() : BOARD_MAP}
          databaseDescriptorMap={loadError ? new Map() : DATABASE_DESCRIPTOR_MAP}
          loading={loading}
          loadError={loadError}
          initialQuery={initialQuery}
          scope={scope}
          currentProjectId={currentProjectId}
          onClose={() => undefined}
          onAccept={(destination) => {
            setAccepted(destination);
          }}
        />
        {accepted ? (
          <div className="border-t border-token-border px-3 py-2 text-xs text-token-description-foreground">
            {accepted.kind === "db"
              ? `DB: ${accepted.projectId}/${accepted.databaseViewId}`
              : `Page: ${accepted.projectId}/${accepted.pageId}`}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const meta = {
  title: "Workbench/Panel destination picker",
  component: PanelDestinationPickerStory,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PanelDestinationPickerStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SearchResults: Story = {
  args: {
    initialQuery: "panel",
  },
};

export const DbOnly: Story = {
  args: {
    scope: "db-only",
  },
};

export const PageOnly: Story = {
  args: {
    scope: "page-only",
  },
  parameters: {
    docs: {
      description: {
        story: "Page-only add-tab picker groups the current project's Pages before Pages from other projects.",
      },
    },
  },
};

export const Loading: Story = {
  args: {
    loading: true,
  },
};

export const Error: Story = {
  args: {
    loadError: "Something went wrong",
  },
};

export const NoResults: Story = {
  args: {
    initialQuery: "zzzzzz",
  },
};
