import type { Meta, StoryObj } from "@storybook/react-vite";
import { Braces, FileText, LayoutTemplate } from "lucide-react";
import { DocumentBearingShellVisual } from "./document-bearing-shell-block";

const meta = {
  title: "Kanban/Document-bearing Blocks/Shells",
  component: DocumentBearingShellVisual,
  parameters: { layout: "fullscreen" },
  render: () => (
    <main className="min-h-screen bg-token-bg-primary p-8 text-token-text-primary">
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-2">
        <p className="mb-1 text-xs text-token-description-foreground">
          Shells retain identity while their owned Documents load independently.
        </p>
        <DocumentBearingShellVisual
          icon={LayoutTemplate}
          label="Template"
          detail="Incident review"
          identity="template:incident-review"
        />
        <DocumentBearingShellVisual
          icon={FileText}
          label="Document"
          detail="Architecture notes"
          identity="large-document:architecture"
        />
        <DocumentBearingShellVisual
          icon={Braces}
          label="Code"
          detail="Sync adapter · typescript"
          identity="large-code:sync-adapter"
        />
      </div>
    </main>
  ),
} satisfies Meta<typeof DocumentBearingShellVisual>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    icon: FileText,
    label: "Document",
    detail: "Architecture notes",
  },
};
