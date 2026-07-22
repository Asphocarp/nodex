import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { VirtualizedTextViewer } from "./virtualized-text-viewer";

const source = Array.from({ length: 10_000 }, (_, index) => (
  `${String(index + 1).padStart(5, "0")}  export const value${index} = ${index};`
)).join("\n");

function ViewerStory() {
  const [wrap, setWrap] = useState(false);
  return (
    <div className="flex h-screen min-h-0 flex-col bg-token-main-surface-primary text-token-foreground">
      <div className="flex h-9 shrink-0 items-center justify-between px-3 text-xs text-token-description-foreground">
        <span className="tabular-nums">10,000 lines · {source.length.toLocaleString()} characters</span>
        <button
          type="button"
          className="rounded-md px-2 py-1 hover:bg-token-foreground/5"
          aria-pressed={wrap}
          onClick={() => setWrap((current) => !current)}
        >
          Wrap
        </button>
      </div>
      <VirtualizedTextViewer
        value={source}
        ariaLabel="Large source example"
        lineNumbers
        wrap={wrap}
        className="min-h-0 flex-1"
      />
    </div>
  );
}

const meta = {
  title: "Shared UI/Virtualized Text Viewer",
  component: VirtualizedTextViewer,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof VirtualizedTextViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Source: Story = {
  args: { value: "", ariaLabel: "Large source example" },
  render: () => <ViewerStory />,
};

export const Wrapped: Story = {
  args: {
    value: `${source}\n${"long-token-".repeat(200)}`,
    ariaLabel: "Wrapped source example",
    lineNumbers: true,
    wrap: true,
    className: "h-screen",
  },
};
