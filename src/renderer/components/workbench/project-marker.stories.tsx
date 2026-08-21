import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PROJECT_MARKER_COLORS, type ProjectAppearance } from "../../../shared/project-appearance";
import { ProjectMarker } from "./project-marker";
import { ProjectMarkerPicker } from "./project-marker-picker";

const meta = {
  title: "Workbench/Project Marker",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function MarkerSurface({ pending = false }: { pending?: boolean }) {
  const [appearance, setAppearance] = useState<ProjectAppearance>({
    color: "blue",
    marker: { kind: "icon", icon: "folder" },
  });

  return (
    <div className="flex min-h-screen items-start justify-center bg-token-main-surface-primary p-16 text-token-foreground">
      <div className="flex items-center gap-3 rounded-xl bg-token-foreground/5 px-3 py-2">
        <ProjectMarkerPicker
          defaultOpen
          portalled={false}
          pending={pending}
          projectName="Nodex desktop"
          appearance={appearance}
          onAppearanceChange={setAppearance}
          headerLabel="Nodex desktop"
        />
        <span className="text-sm font-medium">Nodex desktop</span>
      </div>
    </div>
  );
}

export const PickerOpen: Story = {
  render: () => <MarkerSurface />,
};

export const Pending: Story = {
  render: () => <MarkerSurface pending />,
};

export const ColorAndEmojiGallery: Story = {
  render: () => (
    <div className="min-h-screen bg-token-main-surface-primary p-12 text-token-foreground">
      <div className="mx-auto grid max-w-sm grid-cols-2 gap-x-8 gap-y-4">
        {PROJECT_MARKER_COLORS.map((color, index) => {
          const appearance: ProjectAppearance =
            index === PROJECT_MARKER_COLORS.length - 1
              ? { color, marker: { kind: "emoji", emoji: "🪴" } }
              : { color, marker: { kind: "icon", icon: "folder" } };

          return (
            <div key={color} className="flex items-center gap-2 text-sm">
              <ProjectMarker appearance={appearance} />
              <span>{color}</span>
            </div>
          );
        })}
      </div>
    </div>
  ),
};
