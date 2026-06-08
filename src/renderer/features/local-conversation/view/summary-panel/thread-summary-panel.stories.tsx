import type { Meta, StoryObj } from "@storybook/react-vite";
import { MotionConfig } from "motion/react";
import { BranchStatusIcon, LocalStatusIcon } from "@/components/shared/icons";
import { CODEX_SUMMARY_PANEL_WIDTH } from "@/lib/codex-panel-motion";
import { ThreadFloatingSummaryPanel } from "./thread-floating-summary-panel";
import { ThreadSummaryPanelRow } from "./thread-summary-panel-row";
import { ThreadSummaryPanelSection } from "./thread-summary-panel-section";

function SummaryPanelSurfaceStory({ noGit = false }: { noGit?: boolean }) {
  return (
    <div className="flex min-h-screen items-start justify-end bg-token-main-surface-primary p-10 text-token-text-primary">
      <div
        className="relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-token-border-default bg-token-dropdown-background pt-3 shadow-md select-none"
        style={{ width: CODEX_SUMMARY_PANEL_WIDTH }}
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

function FloatingSummaryPanelStory({
  open = true,
  reducedMotion = false,
}: {
  open?: boolean;
  reducedMotion?: boolean;
}) {
  const content = (
    <div className="flex min-h-screen items-start justify-end bg-token-main-surface-primary p-10 text-token-text-primary">
      <div
        className="relative h-[640px] w-full max-w-4xl overflow-hidden border border-token-border-default bg-(--background)"
        style={{
          "--thread-floating-content-top-inset": "48px",
          "--thread-floating-content-bottom-inset": "16px",
        } as React.CSSProperties}
      >
        <ThreadFloatingSummaryPanel
          mounted
          open={open}
          activeThreadId={null}
          cwd={null}
          projectWorkspacePath={null}
          turns={[]}
          onErrorMessage={() => undefined}
        />
      </div>
    </div>
  );

  if (!reducedMotion) return content;
  return <MotionConfig reducedMotion="always">{content}</MotionConfig>;
}

const meta = {
  title: "Workbench/Threads/Summary Panel",
  component: SummaryPanelSurfaceStory,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SummaryPanelSurfaceStory>;

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

export const FloatingPinnedShiftOpen: StoryObj<typeof FloatingSummaryPanelStory> = {
  render: () => <FloatingSummaryPanelStory open />,
  parameters: {
    docs: {
      description: {
        story: "Pinned floating summary body in the Codex shift band; Workbench applies the companion -158px body/footer shift while this panel springs in from the right.",
      },
    },
  },
};

export const FloatingPinnedGutterOpen: StoryObj<typeof FloatingSummaryPanelStory> = {
  render: () => <FloatingSummaryPanelStory open />,
  parameters: {
    viewport: {
      defaultViewport: "desktop",
    },
    docs: {
      description: {
        story: "Pinned floating summary body in gutter mode, where the panel is visible without shifting thread content.",
      },
    },
  },
};

export const FloatingPinnedClosingReducedMotion: StoryObj<typeof FloatingSummaryPanelStory> = {
  render: () => <FloatingSummaryPanelStory open={false} reducedMotion />,
  parameters: {
    docs: {
      description: {
        story: "Reduced-motion close state: the Codex summary body snaps to opacity 0, translateX(100%), and scale 0.8 without a spring.",
      },
    },
  },
};
