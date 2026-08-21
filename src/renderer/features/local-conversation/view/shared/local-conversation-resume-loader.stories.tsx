import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  buildThreadStageStorySurfaceModels,
  buildThreadStageStoryScenario,
  type ThreadStageStoryControls,
} from "../thread-stage-story-fixtures";
import { LocalConversationResumeLoader } from "./local-conversation-resume-loader";

const RESUMING_STORY_CONTROLS: ThreadStageStoryControls = {
  preset: "resuming",
  permissionMode: "auto",
  authenticatedAccount: true,
  isQueueingEnabled: false,
  collapseAgentBody: true,
};

function buildResumeLoaderArgs() {
  const scenario = buildThreadStageStoryScenario(RESUMING_STORY_CONTROLS);
  const { bodyModel } = buildThreadStageStorySurfaceModels(
    scenario,
    RESUMING_STORY_CONTROLS,
    scenario.runtime,
  );
  if (bodyModel.body.emptyState.type !== "resumingThread") {
    throw new Error(
      "Expected the resuming story fixture to produce the resuming thread empty state.",
    );
  }
  return {
    title: bodyModel.body.emptyState.title,
    description: bodyModel.body.emptyState.description,
  };
}

const resumeLoaderArgs = buildResumeLoaderArgs();

function ResumeLoaderStory(props: typeof resumeLoaderArgs) {
  return (
    <div className="flex min-h-screen bg-token-main-surface-primary">
      <div className="relative mx-auto h-screen w-full max-w-(--thread-content-max-width) px-2.5 md:px-panel">
        <LocalConversationResumeLoader {...props} fillParent />
      </div>
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Shared/Resume Loader",
  component: LocalConversationResumeLoader,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Focused resume-state loader coverage using the same resuming thread fixture as the composed stage story, so the visible copy stays aligned with the real local-conversation projection.",
      },
    },
  },
  args: resumeLoaderArgs,
} satisfies Meta<typeof LocalConversationResumeLoader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Centered: Story = {
  render: (args) => <ResumeLoaderStory {...args} />,
};
