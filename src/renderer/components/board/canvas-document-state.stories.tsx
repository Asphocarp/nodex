import type { Meta, StoryObj } from "@storybook/react-vite";
import { CanvasDocumentState } from "./canvas-document-state";

const meta = {
  title: "Board/Canvas Document State",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-screen bg-token-main-surface-primary">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Opening: Story = {
  render: () => <CanvasDocumentState status="loading" label="Opening canvas…" />,
};

export const ResyncRequired: Story = {
  render: () => (
    <CanvasDocumentState
      status="error"
      message="Canvas content needs to resync before editing can continue."
      retryLabel="Resync"
      onRetry={() => undefined}
    />
  ),
};
