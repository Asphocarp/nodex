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

const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const singleLocalImageTurn = buildStoryConversationTurn({
  turnId: "turn_story_single_image",
  status: "completed",
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_single_image",
      itemId: "user_story_single_image",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "Use this sketch as the visual reference.",
      userAttachments: [
        {
          type: "image",
          id: "user_story_single_image:attachment:image:0",
          source: imageDataUrl,
          sourceKind: "local",
          caption: "sketch.png",
        },
      ],
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_single_image",
      itemId: "assistant_story_single_image",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      assistantPhase: "final_answer",
      markdownText: "I can use the attached sketch.",
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
  ],
});

const mixedAttachmentTurn = buildStoryConversationTurn({
  turnId: "turn_story_mixed_attachments",
  status: "completed",
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_mixed_attachments",
      itemId: "user_story_mixed_attachments",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "Compare these references with the implementation notes.",
      userAttachments: [
        {
          type: "file",
          id: "user_story_mixed_attachments:attachment:file:0",
          label: "notes.md",
          path: "/workspace/nodex/notes.md",
          sourceKind: "mention",
        },
        {
          type: "image",
          id: "user_story_mixed_attachments:attachment:image:1",
          source: imageDataUrl,
          sourceKind: "local",
          caption: "first.png",
        },
        {
          type: "image",
          id: "user_story_mixed_attachments:attachment:image:2",
          source: imageDataUrl,
          sourceKind: "local",
          caption: "second.png",
        },
        {
          type: "image",
          id: "user_story_mixed_attachments:attachment:image:3",
          source: imageDataUrl,
          sourceKind: "local",
          caption: "third.png",
        },
      ],
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_mixed_attachments",
      itemId: "assistant_story_mixed_attachments",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      assistantPhase: "final_answer",
      markdownText: "I compared the notes and images.",
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
  ],
});

const remoteImageTurn = buildStoryConversationTurn({
  turnId: "turn_story_remote_image",
  status: "completed",
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_remote_image",
      itemId: "user_story_remote_image",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "This came from a remote file pointer.",
      userAttachments: [
        {
          type: "image",
          id: "user_story_remote_image:attachment:image:0",
          source: "file-service://story-remote-image",
          sourceKind: "remote",
          caption: "remote.png",
        },
      ],
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_remote_image",
      itemId: "assistant_story_remote_image",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      assistantPhase: "final_answer",
      markdownText: "The pointer resolves through the remote image slot.",
      createdAt: 2_000,
      updatedAt: 2_000,
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
    onRendered: () => {},
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

export const SingleLocalImage: Story = {
  args: {
    turnSearchKey: singleLocalImageTurn.turnId,
    turn: singleLocalImageTurn,
  },
};

export const MixedAttachments: Story = {
  args: {
    turnSearchKey: mixedAttachmentTurn.turnId,
    turn: mixedAttachmentTurn,
  },
};

export const RemoteImageLoading: Story = {
  args: {
    turnSearchKey: remoteImageTurn.turnId,
    turn: remoteImageTurn,
  },
};
