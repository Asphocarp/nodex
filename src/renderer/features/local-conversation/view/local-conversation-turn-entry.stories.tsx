import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocalConversationTurnEntry } from "./local-conversation-turn-entry";
import {
  buildStoryConversationItem,
  buildStoryConversationTurn,
} from "./thread-stage-story-fixtures";

const longThreadTurn = buildStoryConversationTurn({
  turnId: "turn_story_perf",
  status: "completed",
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_perf",
      itemId: "user_story_perf",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "Summarize the performance hotspots in the mounted local thread body.",
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_perf",
      itemId: "assistant_story_perf",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      assistantPhase: "final_answer",
      markdownText: [
        "Memoized turn-local projection keeps older transcript rows stable while the latest turn streams.",
        "",
        "- `_Be` owns turn-local item bucketing",
        "- `jBe` only windows visible rows",
        "- `ZBe` orchestrates search, portals, and deferred long-thread mount",
      ].join("\n"),
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
  ],
});

const assistantThenExecTurn = buildStoryConversationTurn({
  turnId: "turn_story_assistant_exec",
  status: "completed",
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_assistant_exec",
      itemId: "user_story_assistant_exec",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "Inspect the renderer and then run the test suite.",
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_assistant_exec",
      itemId: "assistant_story_assistant_exec",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      assistantPhase: "final_answer",
      markdownText: "I inspected the renderer and queued the verification command.",
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_assistant_exec",
      itemId: "exec_story_assistant_exec",
      type: "command_execution",
      kind: "commandExecution",
      semanticKind: "exec",
      createdAt: 3_000,
      updatedAt: 3_000,
      toolCall: {
        subtype: "command",
        toolName: "exec_command",
        args: {
          command: "bun test src/renderer/features/local-conversation/projection/bucketize-turn-items.test.ts",
        },
      },
      aggregatedOutput: "bun test src/renderer/features/local-conversation/projection/bucketize-turn-items.test.ts",
    }),
  ],
});

const meta = {
  title: "Workbench/Threads/Turn Entry",
  component: LocalConversationTurnEntry,
  args: {
    conversationId: "thread_storybook",
    turnSearchKey: longThreadTurn.turnId,
    turn: longThreadTurn,
    requests: [],
    cwd: "/workspace/nodex",
    isMostRecentTurn: true,
    canEditTurnUserPrefix: true,
    canForkTurnUserPrefix: true,
    projectWorkspacePath: "/workspace/nodex",
    threadCwd: "/workspace/nodex",
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof LocalConversationTurnEntry>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AssistantThenExecInline: Story = {
  args: {
    turnSearchKey: assistantThenExecTurn.turnId,
    turn: assistantThenExecTurn,
  },
};
