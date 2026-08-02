import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { parseDatabaseId } from "../../../shared/database-identities";
import type { LibraryProjectAccessRow } from "../../../shared/library-module";
import { LibraryResourceAccessDialog } from "./library-resource-access-dialog";

const projects: readonly LibraryProjectAccessRow[] = [
  {
    projectId: "project-product",
    projectName: "Product",
    appearance: { color: "blue", marker: { kind: "icon", icon: "folder" } },
    lifecycle: "active",
    directGrant: { access: "read_write", revision: 3 },
    inheritedSources: [],
    effectiveAccess: "read_write",
  },
  {
    projectId: "project-research",
    projectName: "Research",
    appearance: { color: "green", marker: { kind: "icon", icon: "flask" } },
    lifecycle: "active",
    directGrant: null,
    inheritedSources: [{
      kind: "ancestor_page",
      pageId: "page-strategy",
      pageTitle: "Strategy",
      access: "read",
    }],
    effectiveAccess: "read",
  },
  {
    projectId: "project-archive",
    projectName: "2025 Archive",
    appearance: { color: "orange", marker: { kind: "icon", icon: "logs" } },
    lifecycle: "archived",
    directGrant: { access: "read", revision: 2 },
    inheritedSources: [],
    effectiveAccess: "read",
  },
  {
    projectId: "project-primary",
    projectName: "Operations",
    appearance: { color: "purple", marker: { kind: "icon", icon: "wrench" } },
    lifecycle: "active",
    directGrant: null,
    inheritedSources: [{
      kind: "primary_database",
      databaseId: parseDatabaseId("database-operations"),
      databaseName: "Operations",
      access: "read_write",
    }],
    effectiveAccess: "read_write",
  },
];

function Story({ rows = projects }: { rows?: readonly LibraryProjectAccessRow[] }) {
  const [open, setOpen] = useState(true);
  return (
    <NodexTooltipProvider>
      <div className="min-h-screen bg-token-main-surface-primary p-10">
        {!open ? (
          <button
            type="button"
            className="rounded-lg bg-token-foreground px-3 py-2 text-token-dropdown-background"
            onClick={() => setOpen(true)}
          >
            Manage access
          </button>
        ) : null}
        <LibraryResourceAccessDialog
          open={open}
          title="Quarterly planning"
          projects={rows}
          isLoading={false}
          error={null}
          isSaving={false}
          onOpenChange={setOpen}
          onRetry={() => undefined}
          onSave={() => setOpen(false)}
        />
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Library/Resource access dialog",
  component: Story,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Story>;

export default meta;
type StoryDefinition = StoryObj<typeof meta>;

export const MixedAccess: StoryDefinition = {
  render: () => <Story />,
};

export const EmptyLibrary: StoryDefinition = {
  render: () => <Story rows={[]} />,
};
