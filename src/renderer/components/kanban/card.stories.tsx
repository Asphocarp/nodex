import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import type { CardSummary as CardType } from "@/lib/types";
import { Card } from "./card";

const SAMPLE_CARD: CardType = {
  id: "card-active-panel",
  status: "in_progress",
  archived: false,
  title: "Refine panel-aware card focus",
  descriptionPreview: "Selected card-stage tabs should make their matching board cards easy to spot.",
  descriptionLength: "Selected card-stage tabs should make their matching board cards easy to spot.".length,
  hasDescription: true,
  priority: "p1-high",
  estimate: "m",
  tags: ["UI", "Panels"],
  assignee: "alex",
  agentBlocked: false,
  created: new Date("2026-06-17T12:00:00.000Z"),
  order: 0,
};

function CardStoryFrame({
  isActiveInPanel = false,
  isSelected = false,
}: {
  isActiveInPanel?: boolean;
  isSelected?: boolean;
}) {
  return (
    <div className="min-h-screen bg-token-main-surface-primary p-8">
      <div
        className="w-[320px]"
        style={{ "--column-accent": "#3f7adf" } as CSSProperties}
      >
        <Card
          projectId="alpha"
          card={SAMPLE_CARD}
          columnId="in_progress"
          dragDisabled
          isActiveInPanel={isActiveInPanel}
          isSelected={isSelected}
          onClick={() => {}}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Kanban/Card",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <CardStoryFrame />,
};

export const ActiveInPanel: Story = {
  render: () => <CardStoryFrame isActiveInPanel />,
};

export const Selected: Story = {
  render: () => <CardStoryFrame isSelected />,
};
