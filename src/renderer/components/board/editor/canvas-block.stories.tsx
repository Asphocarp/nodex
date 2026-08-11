import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import "@blocknote/shadcn/style.css";

import { CanvasDocumentState } from "@/components/board/canvas-document-state";
import { writeCanvasInlineFramePreference } from "@/lib/canvas-presentation-preference";
import { CanvasBlockFrame } from "./canvas-block";

type StoryStatus =
  | "collapsed"
  | "empty"
  | "populated"
  | "restored-tall"
  | "opening"
  | "error"
  | "deleted";

function CanvasBlockFrameStory({
  status = "populated",
  readOnly = false,
  narrow = false,
  initialTitle = "Launch architecture",
}: {
  readonly status?: StoryStatus;
  readonly readOnly?: boolean;
  readonly narrow?: boolean;
  readonly initialTitle?: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const active =
    status === "empty"
    || status === "populated"
    || status === "restored-tall";

  return (
    <div
      className={
        narrow
          ? "mx-auto w-full max-w-sm px-3 py-8"
          : "mx-auto w-full max-w-4xl px-8 py-12"
      }
    >
      <CanvasBlockFrame
        canvasBlockId="canvas-story"
        title={title}
        active={active}
        loading={status === "opening"}
        heightPreferenceStoreEpoch={
          status === "restored-tall" ? "storybook" : null
        }
        onRename={readOnly ? undefined : setTitle}
        onOpen={() => undefined}
      >
        {status === "populated" || status === "restored-tall" ? (
          <div className="relative h-full bg-token-foreground/2">
            <div className="absolute left-[12%] top-[22%] w-40 rounded-md border border-token-border-default bg-token-main-surface-primary px-3 py-2 text-sm text-token-text-primary shadow-sm">
              Product model
            </div>
            <div className="absolute right-[16%] top-[48%] w-40 rounded-md border border-token-border-default bg-token-main-surface-primary px-3 py-2 text-sm text-token-text-primary shadow-sm">
              Delivery slices
            </div>
          </div>
        ) : status === "empty" ? (
          <div className="flex h-full items-center justify-center bg-[radial-gradient(circle,var(--color-token-border-default)_1px,transparent_1px)] bg-[size:18px_18px] text-sm text-token-text-secondary">
            Empty Canvas
          </div>
        ) : status === "opening" ? (
          <CanvasDocumentState status="loading" label="Opening Canvas…" />
        ) : status === "error" ? (
          <CanvasDocumentState
            status="error"
            message="Canvas could not be opened"
            onRetry={() => undefined}
          />
        ) : status === "deleted" ? (
          <div className="flex h-full items-center justify-center px-4 text-sm text-token-text-secondary">
            This Canvas has been deleted.
          </div>
        ) : (
          <div
            className="flex h-full w-full items-center justify-center bg-token-foreground/2 text-sm text-token-text-secondary"
          >
            Canvas is outside the active viewport.
          </div>
        )}
      </CanvasBlockFrame>
    </div>
  );
}

const meta = {
  title: "Board/Editor/Canvas Block",
  component: CanvasBlockFrameStory,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The owning Page shell for an independently persisted Canvas Document. Near-visible Canvases are admitted automatically; offscreen shells remain compact.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="bn-shadcn min-h-screen bg-token-main-surface-primary">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CanvasBlockFrameStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  args: { status: "collapsed" },
};

export const ActiveEmpty: Story = {
  args: { status: "empty" },
};

export const ActivePopulated: Story = {};

export const ProjectDefaultName: Story = {
  args: { initialTitle: "Research Canvas" },
};

export const RestoredTall: Story = {
  args: { status: "restored-tall" },
  beforeEach: () => {
    writeCanvasInlineFramePreference({
      storeEpoch: "storybook",
      canvasBlockId: "canvas-story",
    }, { heightPx: 640 });
  },
};

export const Opening: Story = {
  args: { status: "opening" },
};

export const Error: Story = {
  args: { status: "error" },
};

export const Deleted: Story = {
  args: { status: "deleted" },
};

export const ReadOnlyInheritedGrant: Story = {
  args: { status: "populated", readOnly: true },
};

export const NarrowMobilePage: Story = {
  args: { status: "populated", narrow: true },
};
