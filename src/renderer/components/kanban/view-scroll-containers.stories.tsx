import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  KanbanBoardScrollContainer,
  ToggleListScrollContainer,
} from "./view-scroll-containers";

const meta = {
  title: "Kanban/View Scroll Containers",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function ScrollStoryShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen bg-token-main-surface-primary p-6">
      <div className="h-full rounded-[24px] border-[0.5px] border-token-border bg-token-main-surface-primary p-4">
        {children}
      </div>
    </div>
  );
}

function HorizontalOverflowContent() {
  return (
    <div className="flex min-w-max gap-4 pr-6">
      {Array.from({ length: 7 }, (_, index) => (
        <section
          key={index}
          className="flex h-[420px] w-72 shrink-0 flex-col rounded-2xl border-[0.5px] border-token-border bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)] p-3"
        >
          <header className="text-sm font-medium text-token-text-primary">
            Column {index + 1}
          </header>
          <div className="mt-3 space-y-2">
            {Array.from({ length: 4 }, (_, cardIndex) => (
              <div
                key={cardIndex}
                className="rounded-xl bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] px-3 py-2 text-sm text-token-text-secondary"
              >
                Card {cardIndex + 1}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function VerticalOverflowContent() {
  return (
    <div className="space-y-2 pr-2">
      {Array.from({ length: 20 }, (_, index) => (
        <div
          key={index}
          className="rounded-xl bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] px-3 py-2 text-sm text-token-text-secondary"
        >
          Toggle row {index + 1}
        </div>
      ))}
    </div>
  );
}

export const KanbanHorizontalOverflow: Story = {
  render: () => (
    <ScrollStoryShell>
      <KanbanBoardScrollContainer>
        <HorizontalOverflowContent />
      </KanbanBoardScrollContainer>
    </ScrollStoryShell>
  ),
};

export const ToggleListVerticalOverflow: Story = {
  render: () => (
    <ScrollStoryShell>
      <div className="h-full">
        <ToggleListScrollContainer>
          <VerticalOverflowContent />
        </ToggleListScrollContainer>
      </div>
    </ScrollStoryShell>
  ),
};
