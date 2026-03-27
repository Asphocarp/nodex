import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Layers3 } from "lucide-react";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownChoiceMenu,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { PROJECTION_ACTION_BTN } from "./projection-drag-handle";

const PROJECT_OPTIONS = [
  { value: "default", label: "Nodex" },
  { value: "bundle", label: "Codex bundle" },
  { value: "scratch", label: "Scratchpad" },
];

function CardRefToolbarStory() {
  const [sourceProjectId, setSourceProjectId] = useState("default");

  return (
    <div className="min-h-screen bg-(--background) p-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-[20px] border border-(--border) bg-(--card) p-5">
        <section className="relative box-border w-full max-w-full rounded-lg bg-transparent p-0">
          <div className="inline-flex items-center gap-1 rounded-lg px-0.5 py-0.5">
            <NodexDropdownChoiceMenu
              value={sourceProjectId}
              onValueChange={setSourceProjectId}
              options={PROJECT_OPTIONS}
              triggerButton={(
                <NodexDropdownButtonTrigger className={cn(PROJECTION_ACTION_BTN, "h-7! pr-2")}>
                  <span className="inline-flex items-center gap-1.5">
                    <Layers3 className="size-3.5" />
                    {sourceProjectId}
                  </span>
                </NodexDropdownButtonTrigger>
              )}
            />
          </div>

          <div className="mt-3 rounded-lg border border-(--border) bg-(--background-secondary) p-3 text-sm text-(--foreground-secondary)">
            Projected card preview surface
          </div>
        </section>
      </div>
    </div>
  );
}

const meta = {
  title: "Kanban/Card Ref Block",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Story-only harness for the card-ref floating project selector chrome.",
      },
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const FloatingToolbar: Story = {
  render: () => <CardRefToolbarStory />,
};
