import type { Meta, StoryObj } from "@storybook/react-vite";

import { ActivitySpinnerIcon } from "@/components/shared/icons";
import { PageStageContentSkeleton } from "@/components/board/page-stage/content-skeleton";
import { GeneratedImageGallery } from "@/features/local-conversation/view/shared/generated-image-gallery";
import { CodexShimmerText } from "@/features/local-conversation/view/shared/codex-shimmer-text";
import { AppStartupScreen } from "@/components/app-startup-screen";
import { LoadingPlaceholder } from "./loading-placeholder";
import { LoadingResultsShimmer } from "./loading-results-shimmer";
import { NodexLogoShimmer } from "./nodex-logo-shimmer";

const meta = {
  title: "Design System/Loading motion",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const PrimitiveMatrix: Story = {
  render: () => (
    <div className="grid max-w-3xl grid-cols-[10rem_1fr] gap-x-8 gap-y-7 p-8 text-sm">
      <span className="text-token-text-secondary">Activity spinner</span>
      <div role="status" aria-label="Loading" className="flex items-center gap-2">
        <ActivitySpinnerIcon />
        <span>Loading project data…</span>
      </div>

      <span className="text-token-text-secondary">Cadenced activity</span>
      <CodexShimmerText>Running checks</CodexShimmerText>

      <span className="text-token-text-secondary">Classic activity</span>
      <CodexShimmerText variant="classic">Browser is working</CodexShimmerText>

      <span className="text-token-text-secondary">Result lines</span>
      <div role="status" aria-label="Loading results" className="max-w-md">
        <LoadingResultsShimmer seed="storybook-loading-results" />
      </div>

      <span className="text-token-text-secondary">Canvas placeholder</span>
      <LoadingPlaceholder
        aria-label="Loading canvas"
        className="h-28 max-w-md rounded-xl"
        role="status"
      />

      <span className="text-token-text-secondary">Startup identity</span>
      <NodexLogoShimmer />
    </div>
  ),
};

export const PageStageLoading: Story = {
  render: () => (
    <div className="mx-auto max-w-4xl p-10">
      <PageStageContentSkeleton titleSnapshot="Loading-motion parity" />
    </div>
  ),
};

export const StartupStuckLoader: Story = {
  render: () => <AppStartupScreen step={{ phase: "opening_workspace" }} />,
};

export const GeneratedImagePendingCarousel: Story = {
  render: () => (
    <div className="w-[420px] p-4">
      <GeneratedImageGallery images={[]} pendingImageCount={6} />
    </div>
  ),
};
