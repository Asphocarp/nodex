import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Filter, Rows3, ArrowUpDown } from "@/components/shared/icons/generic-icons";
import {
  DbViewDisplayPopover,
  DbViewFilterPopover,
  DbViewRulesSummaryRow,
  DbViewSortPopover,
} from "./db-view-toolbar-rules";
import { NodexButton } from "@/components/ui/button";
import {
  DB_VIEW_SORT_FIELDS,
  getDefaultDbViewPrefs,
  type DbViewPrefs,
} from "@/lib/db-view-prefs";

function StorySurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-token-main-surface-primary p-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 rounded-[20px] border border-token-border bg-token-main-surface-secondary p-5">
        {children}
      </div>
    </div>
  );
}

function DbViewToolbarRulesStory() {
  const [prefs, setPrefs] = useState<DbViewPrefs>(() => getDefaultDbViewPrefs("toggle-list"));
  const [filterOpen, setFilterOpen] = useState(true);
  const [sortOpen, setSortOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);

  return (
    <StorySurface>
      <DbViewRulesSummaryRow
        view="toggle-list"
        prefs={prefs}
        onOpenFilter={() => setFilterOpen(true)}
        onOpenSort={() => setSortOpen(true)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <DbViewFilterPopover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          prefs={prefs}
          availableTags={["sidebar", "thread", "manual", "simple"]}
          onChange={(update) => setPrefs((current) => update(current))}
        >
          <NodexButton variant="secondary" size="sm">
            <Filter className="size-4" />
            Filters
          </NodexButton>
        </DbViewFilterPopover>

        <DbViewSortPopover
          open={sortOpen}
          onOpenChange={setSortOpen}
          view="toggle-list"
          prefs={prefs}
          availableSortFields={[...DB_VIEW_SORT_FIELDS]}
          onChange={(update) => setPrefs((current) => update(current))}
        >
          <NodexButton variant="secondary" size="sm">
            <ArrowUpDown className="size-4" />
            Sort
          </NodexButton>
        </DbViewSortPopover>

        <DbViewDisplayPopover
          open={displayOpen}
          onOpenChange={setDisplayOpen}
          view="toggle-list"
          prefs={prefs}
          onChange={(update) => setPrefs((current) => update(current))}
        >
          <NodexButton variant="secondary" size="sm">
            <Rows3 className="size-4" />
            Display
          </NodexButton>
        </DbViewDisplayPopover>
      </div>
    </StorySurface>
  );
}

const meta = {
  title: "Workbench/DB View Toolbar Rules",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const FilterOpen: Story = {
  render: () => <DbViewToolbarRulesStory />,
};

export const SortOpen: Story = {
  render: () => {
    function SortOpenStory() {
      const [prefs, setPrefs] = useState<DbViewPrefs>(() => getDefaultDbViewPrefs("toggle-list"));
      return (
        <StorySurface>
          <DbViewSortPopover
            open={true}
            onOpenChange={() => {}}
            view="toggle-list"
            prefs={prefs}
            availableSortFields={[...DB_VIEW_SORT_FIELDS]}
            onChange={(update) => setPrefs((current) => update(current))}
          >
            <NodexButton variant="secondary" size="sm">Sort</NodexButton>
          </DbViewSortPopover>
        </StorySurface>
      );
    }

    return <SortOpenStory />;
  },
};

export const DisplayOpen: Story = {
  render: () => {
    function DisplayOpenStory() {
      const [prefs, setPrefs] = useState<DbViewPrefs>(() => getDefaultDbViewPrefs("toggle-list"));
      return (
        <StorySurface>
          <DbViewDisplayPopover
            open={true}
            onOpenChange={() => {}}
            view="toggle-list"
            prefs={prefs}
            onChange={(update) => setPrefs((current) => update(current))}
          >
            <NodexButton variant="secondary" size="sm">Display</NodexButton>
          </DbViewDisplayPopover>
        </StorySurface>
      );
    }

    return <DisplayOpenStory />;
  },
};
