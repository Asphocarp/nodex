import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkbenchStageToolbar } from "./workbench-shell";

type StageToolbarStoryArgs = {
  showDivider: boolean;
};

const meta = {
  title: "Workbench/Stage toolbar",
  args: {
    showDivider: true,
  },
  render: (args) => <StageToolbarStory {...args} />,
} satisfies Meta<StageToolbarStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

function StageToolbarStory({ showDivider }: StageToolbarStoryArgs) {
  return (
    <div className="min-h-56 bg-(--background-secondary) p-6 text-(--foreground)">
      <div className="overflow-hidden rounded-xl bg-(--background) shadow-[0_18px_56px_rgba(0,0,0,0.16)]">
        <WorkbenchStageToolbar showDivider={showDivider}>
          <div className="flex items-center text-xs text-(--foreground-secondary)">Nodex</div>
          <div className="justify-self-center">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-5 rounded-full bg-(--foreground)" />
              <span className="h-1.5 w-5 rounded-full bg-(--foreground)/25" />
              <span className="h-1.5 w-5 rounded-full bg-(--foreground)/25" />
            </div>
          </div>
          <div className="flex items-center justify-end">
            <span className="size-7 rounded-lg bg-(--foreground)/5" />
          </div>
        </WorkbenchStageToolbar>
        <div className="grid h-32 grid-cols-2 divide-x divide-(--border)">
          <div className="p-3 text-xs text-(--foreground-secondary)">Views</div>
          <div className="p-3 text-xs text-(--foreground-secondary)">Cards</div>
        </div>
      </div>
    </div>
  );
}

export const MultipleStages: Story = {
  args: {
    showDivider: true,
  },
};

export const SingleStage: Story = {
  args: {
    showDivider: false,
  },
};
