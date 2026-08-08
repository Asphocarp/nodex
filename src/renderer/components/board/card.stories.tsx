import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import type { DatabasePageSummary as CardType } from "@/lib/types";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import { Card } from "./card";

const SAMPLE_CARD: CardType = {
  id: "card-active-panel",
  pageKey: "LAB-13",
  status: "build",
  archived: false,
  title: "Refine panel-aware card focus",
  richTitle: plainTextToPortableRichText("Refine panel-aware card focus"),
  descriptionPreview: "Selected page-stage tabs should make their matching board cards easy to spot.",
  descriptionLength: "Selected page-stage tabs should make their matching board cards easy to spot.".length,
  hasDescription: true,
  priority: "p1-high",
  estimate: "m",
  tags: ["o_AAAAAAAA", "o_BBBBBBBB"],
  assignee: "alex",
  created: new Date("2026-06-17T12:00:00.000Z"),
  order: 0,
};

function CardStoryFrame({
  isPresented = false,
  isKeyboardActive = false,
  isSelected = false,
  dragDisabled = true,
  showPageKey = false,
}: {
  isPresented?: boolean;
  isKeyboardActive?: boolean;
  isSelected?: boolean;
  dragDisabled?: boolean;
  showPageKey?: boolean;
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
          columnId="build"
          tagOptions={[
            { id: "o_AAAAAAAA", name: "UI", color: "blue" },
            { id: "o_BBBBBBBB", name: "Panels", color: "gray" },
          ]}
          dragDisabled={dragDisabled}
          showPageKey={showPageKey}
          isPresented={isPresented}
          isKeyboardActive={isKeyboardActive}
          isSelected={isSelected}
          onClick={() => {}}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Board/Card",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <CardStoryFrame />,
};

export const WithPageKey: Story = {
  render: () => <CardStoryFrame showPageKey />,
};

export const Presented: Story = {
  render: () => <CardStoryFrame isPresented />,
};

export const Selected: Story = {
  render: () => <CardStoryFrame isSelected />,
};

export const PresentedAndSelected: Story = {
  render: () => <CardStoryFrame isPresented isSelected />,
};

export const PresentedAndKeyboardActive: Story = {
  render: () => <CardStoryFrame isPresented isKeyboardActive />,
};

/** Draggable cards retain their click affordance until a drag actually starts. */
export const Draggable: Story = {
  render: () => <CardStoryFrame dragDisabled={false} />,
};
