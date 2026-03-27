import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  CommandPaletteCardFilterPopover,
  CommandPaletteCardFiltersSummaryRow,
} from "./command-palette-filters";
import {
  getDefaultCommandPaletteCardFilters,
  type CommandPaletteCardFilters,
} from "@/lib/command-palette";
import { NodexButton } from "@/components/ui/button";

function CommandPaletteFiltersStory() {
  const [open, setOpen] = useState(true);
  const [filters, setFilters] = useState<CommandPaletteCardFilters>(() => ({
    ...getDefaultCommandPaletteCardFilters(),
    statuses: ["draft", "in_progress", "in_review"],
    priorities: ["p0-critical", "p1-high"],
    tags: ["sidebar", "thread"],
    projectIds: ["default"],
  }));

  return (
    <div className="min-h-screen bg-token-main-surface-primary p-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 rounded-[20px] border border-token-border bg-token-main-surface-secondary p-5">
        <CommandPaletteCardFiltersSummaryRow
          filters={filters}
          projectNameById={new Map([["default", "Nodex"], ["bundle", "Codex bundle"]])}
          onOpenFilter={() => setOpen(true)}
        />
        <CommandPaletteCardFilterPopover
          open={open}
          onOpenChange={setOpen}
          filters={filters}
          availableTags={["sidebar", "thread", "manual", "simple"]}
          availableAssignees={["Annie", "John", "Sam"]}
          availableProjects={[
            { id: "default", label: "Nodex" },
            { id: "bundle", label: "Codex bundle" },
          ]}
          disabled={false}
          onChange={(update) => setFilters((current) => update(current))}
        >
          <NodexButton variant="secondary">Filters</NodexButton>
        </CommandPaletteCardFilterPopover>
      </div>
    </div>
  );
}

const meta = {
  title: "Workbench/Command Palette Filters",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: () => <CommandPaletteFiltersStory />,
};
