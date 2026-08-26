import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodexButton } from "@/components/ui/button";
import { ImagePreviewDialog } from "./image-preview-dialog";

function svgFixture(label: string, accent: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
      <rect width="1280" height="800" fill="#111317"/>
      <path d="M0 0h640v400H0zM640 400h640v400H640z" fill="#1b1e24"/>
      <circle cx="640" cy="400" r="210" fill="${accent}" opacity=".82"/>
      <text x="640" y="420" text-anchor="middle" fill="white" font-family="sans-serif" font-size="54">${label}</text>
    </svg>
  `)}`;
}

const FIXTURES = [
  svgFixture("Attachment 1", "#2563eb"),
  svgFixture("Attachment 2", "#0f766e"),
  svgFixture("Attachment 3", "#b45309"),
] as const;

function ImagePreviewStory() {
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);
  const [lastAction, setLastAction] = useState("No edit requested");
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="min-h-screen bg-token-main-surface-primary p-8 text-token-foreground">
      <div className="flex items-center gap-3">
        <NodexButton ref={triggerRef} size="sm" onClick={() => setOpen(true)}>
          Open image preview
        </NodexButton>
        <span className="text-sm text-token-description-foreground">{lastAction}</span>
      </div>
      <ImagePreviewDialog
        open={open}
        onOpenChange={setOpen}
        src={FIXTURES[index]}
        alt={`Synthetic attachment ${index + 1}`}
        downloadFileName={`attachment-${index + 1}.svg`}
        onPreviousImage={index > 0 ? () => setIndex(index - 1) : undefined}
        onNextImage={index < FIXTURES.length - 1 ? () => setIndex(index + 1) : undefined}
        onEditImage={() => setLastAction(`Edit requested for attachment ${index + 1}`)}
        finalFocus={() => {
          triggerRef.current?.focus();
          return false;
        }}
      />
    </div>
  );
}

const meta = {
  title: "Image Editor/Preview Dialog",
  parameters: {
    a11y: { test: "error" },
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <ImagePreviewStory />,
};
