import type { Meta, StoryObj } from "@storybook/react-vite";
import { InlineCardCreator } from "./inline-card-creator";

function StorySurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-(--background) p-8">
      <div className="mx-auto max-w-xl rounded-[20px] border border-(--border) bg-(--card) p-6">
        {children}
      </div>
    </div>
  );
}

const meta = {
  title: "Kanban/Inline Card Creator",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <StorySurface>
      <InlineCardCreator
        onSave={async () => {}}
        onCancel={() => {}}
      />
    </StorySurface>
  ),
};
