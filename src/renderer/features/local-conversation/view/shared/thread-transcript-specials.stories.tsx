import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { ReasoningSurface } from "./reasoning-surface";
import { TodoListSurface } from "./todo-list-surface";

function StorySurface({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[320px] rounded-[24px] border border-(--border) bg-(--background) p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-2xl">
        <div className="text-sm font-semibold text-(--foreground)">{title}</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">{description}</div>
      </div>
      <div className="max-w-3xl">{children}</div>
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Transcript Specials",
  component: StorySurface,
  parameters: {
    docs: {
      description: {
        component:
          "Focused parity coverage for the Codex-style reasoning accordion and todo-list card renderers used in the thread transcript.",
      },
    },
  },
  args: {
    title: "Transcript special",
    description: "Focused transcript renderer surface.",
    children: null,
  },
} satisfies Meta<typeof StorySurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ReasoningStreaming: Story = {
  render: () => (
    <StorySurface
      title="Reasoning Streaming"
      description="The streaming reasoning renderer keeps the preview body open and uses the Codex Thinking shimmer summary."
    >
      <ReasoningSurface
        item={{
          markdownText: "**Investigating**\n\nChecking the failing story state.\n\n- comparing bundle behavior\n- checking transcript buckets",
          status: "inProgress",
        }}
        parseIncompleteMarkdown
      />
    </StorySurface>
  ),
};

export const ReasoningCompleted: Story = {
  render: () => (
    <StorySurface
      title="Reasoning Completed"
      description="Completed reasoning collapses back to the Codex Thought summary and can be reopened on demand."
    >
      <ReasoningSurface
        item={{
          markdownText: "**Investigating**\n\nChecking the failing story state.\n\n- comparing bundle behavior\n- checking transcript buckets",
          status: "completed",
        }}
      />
    </StorySurface>
  ),
};

export const TodoList: Story = {
  render: () => (
    <StorySurface
      title="Todo List"
      description="The full Codex-style todo card shows completion progress, current-step emphasis, and the measured expandable body."
    >
      <TodoListSurface
        item={{
          markdownText: [
            "- [x] Audit the bundle",
            "- [ ] Port the todo shell",
            "- [ ] Update stories and tests",
          ].join("\n"),
          status: "inProgress",
          rawItem: undefined,
        }}
      />
    </StorySurface>
  ),
};

export const TodoListCompleted: Story = {
  render: () => (
    <StorySurface
      title="Todo List Completed"
      description="Completed todo plans can also render from structured raw plan payloads when available."
    >
      <TodoListSurface
        item={{
          markdownText: "",
          status: "completed",
          rawItem: {
            plan: [
              { step: "Audit the bundle", status: "completed" },
              { step: "Port the todo shell", status: "completed" },
              { step: "Update stories and tests", status: "completed" },
            ],
          },
        }}
      />
    </StorySurface>
  ),
};
