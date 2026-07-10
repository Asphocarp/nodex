import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties, ReactNode } from "react";
import { DropIndicator } from "./drop-indicator";

function BoardTarget({ label, empty = false, collapsed = false }: {
  label?: string;
  empty?: boolean;
  collapsed?: boolean;
}) {
  return (
    <div
      className="relative min-h-28 rounded-lg border border-(--border) bg-(--card) p-3"
      style={{ "--column-accent": "#4d8ee8" } as CSSProperties}
    >
      <div className="mb-5 flex items-center justify-between text-xs font-medium text-(--foreground-secondary)">
        <span>{collapsed ? "In review · collapsed" : empty ? "Draft · empty" : "In progress"}</span>
        <span className="text-(--foreground-tertiary)">{collapsed ? "3" : empty ? "0" : "4"}</span>
      </div>
      {empty || collapsed ? (
        <div className="rounded-md bg-[color-mix(in_srgb,var(--column-accent)_8%,transparent)] px-3 py-6 text-center text-xs text-(--foreground-tertiary)">
          {label ?? "Move here"}
        </div>
      ) : (
        <div className="relative mt-8">
          <DropIndicator className="absolute inset-x-0" label={label} />
        </div>
      )}
    </div>
  );
}

function EditorTarget({ copy = false }: { copy?: boolean }) {
  return (
    <div className="nfm-editor relative min-h-28 rounded-lg border border-(--border) bg-(--card) p-4">
      <p className="text-sm text-(--foreground-secondary)">Existing editor block</p>
      <div
        data-card-drop-indicator=""
        data-copy={copy ? "" : undefined}
        className="top-14! right-4! left-4! w-auto!"
      />
      <p className="mt-9 text-sm text-(--foreground-tertiary)">
        {copy ? "Copy insertion" : "Move insertion"}
      </p>
    </div>
  );
}

function State({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium text-(--foreground-tertiary)">{title}</h2>
      {children}
    </section>
  );
}

function FeedbackStates() {
  return (
    <div className="min-h-screen bg-(--background) p-8">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-5">
        <State title="Board · move"><BoardTarget /></State>
        <State title="Board · copy"><BoardTarget label="Copy" /></State>
        <State title="Board · inferred property"><BoardTarget label="Copy · Priority P1 High" /></State>
        <State title="Board · empty"><BoardTarget empty label="Copy" /></State>
        <State title="Board · collapsed"><BoardTarget collapsed label="Copy · Add #manual" /></State>
        <State title="Editor · move"><EditorTarget /></State>
        <State title="Editor · copy"><EditorTarget copy /></State>
      </div>
    </div>
  );
}

const meta = {
  title: "Kanban/Cross-window drop feedback",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const MoveCopyAndInference: Story = {
  render: () => <FeedbackStates />,
};
