import type { Meta, StoryObj } from "@storybook/react-vite";
import { BranchStatusIcon, LocalStatusIcon } from "@/components/shared/icons";
import { ThreadSummaryPanelRow } from "./thread-summary-panel-row";
import { ThreadSummaryPanelSection } from "./thread-summary-panel-section";

function SummaryPanelStory({ noGit = false }: { noGit?: boolean }) {
  return (
    <div className="flex min-h-screen items-start justify-end bg-token-main-surface-primary p-10 text-token-text-primary">
      <div
        className="relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-token-border-default bg-token-dropdown-background pt-3 shadow-md select-none"
        style={{ width: 300 }}
      >
        <div className="flex h-fit max-h-full min-h-0 flex-col gap-3 overflow-y-auto pb-3">
          <ThreadSummaryPanelSection title="Environment">
            <ThreadSummaryPanelRow
              label="Changes"
              trailing={<span className="text-size-chat text-token-text-tertiary">{noGit ? "No Git" : "+9,212 -4,412"}</span>}
              trailingVisible
              disabled={noGit}
              interactive={!noGit}
            />
            <ThreadSummaryPanelRow label="Local" icon={<LocalStatusIcon />} trailing={<span className="text-size-chat text-token-text-tertiary">Work locally</span>} trailingVisible />
            <ThreadSummaryPanelRow label="dev-redesign" icon={<BranchStatusIcon />} disabled={noGit} />
            <ThreadSummaryPanelRow label="Commit or push" disabled={noGit} interactive={!noGit} />
            <ThreadSummaryPanelRow label="Create pull request" disabled={noGit} interactive={!noGit} />
          </ThreadSummaryPanelSection>
          <ThreadSummaryPanelSection title="Sources">
            <div className="flex flex-wrap gap-1.5 py-0.5" aria-label="Sources">
              <span className="inline-flex h-6 items-center gap-1 rounded-lg bg-token-foreground/5 px-2 text-size-chat text-token-foreground">
                <span className="size-1.5 shrink-0 rounded-full bg-token-text-link-foreground" aria-hidden="true" />
                Context7
              </span>
            </div>
          </ThreadSummaryPanelSection>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Summary Panel",
  component: SummaryPanelStory,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SummaryPanelStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ActiveThreadWithSources: Story = {};

export const NoGitRepository: Story = {
  args: {
    noGit: true,
  },
};

export const PinnedOverlaySurface: Story = {
  args: {},
  parameters: {
    docs: {
      description: {
        story: "Surface chrome used by the pinned floating summary overlay while the workbench right panel is collapsed.",
      },
    },
  },
};
