import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodexTooltip, NodexTooltipProvider } from "@/components/ui/tooltip";
import type { ContextWindowIndicatorState } from "@/lib/codex-context-window";
import { ContextWindowTooltipContent } from "./context-window";

interface ContextWindowTooltipStoryProps {
  state: ContextWindowIndicatorState;
  showAutoCompactionNote: boolean;
}

function ContextWindowTooltipStory({
  state,
  showAutoCompactionNote,
}: ContextWindowTooltipStoryProps) {
  return (
    <div className="min-h-[220px] rounded-[24px] border border-(--border) bg-(--background) p-6 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-xl">
        <div className="text-sm font-semibold text-(--foreground)">Context Window Tooltip</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">
          Codex Electron parity harness for the composer footer context-window tooltip. The open state stays pinned so the exact copy, width, spacing, and conditional compaction line are reviewable in Storybook.
        </div>
      </div>
      <NodexTooltipProvider>
        <NodexTooltip
          open={true}
          side="top"
          tooltipContent={(
            <ContextWindowTooltipContent
              state={state}
              showAutoCompactionNote={showAutoCompactionNote}
            />
          )}
        >
          <button
            type="button"
            className="ml-2 inline-flex items-center gap-1 rounded-full text-token-description-foreground"
          >
            <span className="inline-flex size-3 rounded-full border-2 border-current opacity-80" />
            {state.status === "ready" ? null : (
              <span className="composer-footer__label--sm select-none whitespace-nowrap text-sm text-token-input-placeholder-foreground opacity-60">
                0%
              </span>
            )}
          </button>
        </NodexTooltip>
      </NodexTooltipProvider>
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Context Window Tooltip",
  component: ContextWindowTooltipStory,
  args: {
    state: {
      status: "ready",
      percentFull: 44,
      usedTokens: 113_400,
      windowTokens: 258_200,
    },
    showAutoCompactionNote: true,
  },
  parameters: {
    docs: {
      description: {
        component:
          "Focused parity story for the Codex Electron context-window tooltip shown beside the composer footer meter.",
      },
    },
  },
} satisfies Meta<typeof ContextWindowTooltipStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const UsedLeft: Story = {};

export const Full: Story = {
  args: {
    state: {
      status: "ready",
      percentFull: 71,
      usedTokens: 182_000,
      windowTokens: 258_000,
    },
    showAutoCompactionNote: false,
  },
};

export const Fallback: Story = {
  args: {
    state: {
      status: "unavailable",
      percentFull: 0,
      usedTokens: null,
      windowTokens: null,
    },
    showAutoCompactionNote: false,
  },
};
