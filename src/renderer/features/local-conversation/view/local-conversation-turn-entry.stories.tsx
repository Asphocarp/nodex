import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { buildCodexFileChangeMap } from "../../../../shared/codex-file-change";
import type { CodexConversationTurn } from "../../../lib/types";
import type { VisibleConversationTurnEntry } from "../selectors";
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
          command:
            "bun test src/renderer/features/local-conversation/projection/bucketize-turn-items.test.ts",
        },
      },
      aggregatedOutput:
        "bun test src/renderer/features/local-conversation/projection/bucketize-turn-items.test.ts",
    }),
  ],
});

const stoppedToolGroupBeforeActionsTurn = buildStoryConversationTurn({
  turnId: "turn_story_stopped_tool_group_before_actions",
  status: "completed",
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_stopped_tool_group_before_actions",
      itemId: "assistant_story_stopped_tool_group_before_actions",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      status: "completed",
      assistantPhase: "final_answer",
      markdownText:
        "I found the relevant rendering path and stopped after checking the final files.",
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_stopped_tool_group_before_actions",
      itemId: "exec_story_stopped_read_1",
      type: "command_execution",
      kind: "commandExecution",
      semanticKind: "exec",
      status: "completed",
      createdAt: 3_000,
      updatedAt: 3_000,
      commandActions: [
        {
          type: "read",
          command: "",
          name: "read",
          path: "src/renderer/features/local-conversation/projection/build-turn-view-model.ts",
        },
      ],
      toolCall: {
        subtype: "command",
        toolName: "exec_command",
        args: {},
      },
    }),
    buildStoryConversationItem({
      turnId: "turn_story_stopped_tool_group_before_actions",
      itemId: "exec_story_stopped_read_2",
      type: "command_execution",
      kind: "commandExecution",
      semanticKind: "exec",
      status: "completed",
      createdAt: 4_000,
      updatedAt: 4_000,
      commandActions: [
        {
          type: "read",
          command: "",
          name: "read",
          path: "src/renderer/features/local-conversation/view/local-conversation-thread-turn.tsx",
        },
      ],
      toolCall: {
        subtype: "command",
        toolName: "exec_command",
        args: {},
      },
    }),
  ],
});

const v2MaximalActivityUnitsTurn = buildStoryConversationTurn({
  turnId: "turn_story_v2_maximal_activity_units",
  status: "completed",
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_v2_maximal_activity_units",
      itemId: "exec_story_v2",
      type: "command_execution",
      kind: "commandExecution",
      semanticKind: "exec",
      status: "completed",
      commandActions: [{ type: "unknown", command: "bun run typecheck" }],
      toolCall: { subtype: "command", toolName: "exec_command", args: {} },
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_v2_maximal_activity_units",
      itemId: "handoff_story_v2",
      type: "dynamic_tool_call",
      kind: "toolCall",
      semanticKind: "dynamicToolCall",
      status: "completed",
      dynamicToolCall: {
        callId: "handoff_story_v2",
        namespace: "codex_app",
        tool: "handoff_thread",
        arguments: { threadId: "thread_child" },
        status: "completed",
        contentItems: null,
        success: true,
        durationMs: 120,
        completed: true,
      },
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_v2_maximal_activity_units",
      itemId: "patch_story_v2",
      type: "file_change",
      kind: "fileChange",
      semanticKind: "patch",
      status: "completed",
      fileChange: {
        changes: buildCodexFileChangeMap([
          {
            type: "add",
            path: "src/renderer/features/local-conversation/projection/agent-activity-v2.ts",
            content: "export const activityVersion = 2;",
          },
        ]),
      },
      createdAt: 3_000,
      updatedAt: 3_000,
    }),
  ],
});

const assistantAfterDiffTurn = buildStoryConversationTurn({
  turnId: "turn_story_assistant_after_diff",
  status: "completed",
  diff: [
    "--- a/src/renderer/features/local-conversation/view/local-conversation-thread-turn.tsx",
    "+++ b/src/renderer/features/local-conversation/view/local-conversation-thread-turn.tsx",
    "@@ -1,3 +1,4 @@",
    ' import { ThreadTurn } from "./local-conversation-thread-turn";',
    '+import { useWorkedForLabelText } from "./shared/use-worked-for-label";',
  ].join("\n"),
  finalAssistantStartedAtMs: 180_000,
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_assistant_after_diff",
      itemId: "user_story_assistant_after_diff",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "Make the transcript row match the current Codex ordering.",
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_assistant_after_diff",
      itemId: "assistant_story_assistant_after_diff",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      assistantPhase: "final_answer",
      markdownText: "The final assistant owns the completed file summary before the action strip.",
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
  ],
});

const historicalWorkedForTurn = buildStoryConversationTurn({
  turnId: "turn_story_historical_worked_for",
  status: "completed",
  durationMs: 125_000,
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_historical_worked_for",
      itemId: "user_story_historical_worked_for",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "Audit the old turn collapse label.",
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_historical_worked_for",
      itemId: "exec_story_historical_worked_for",
      type: "command_execution",
      kind: "commandExecution",
      semanticKind: "exec",
      status: "completed",
      createdAt: 2_000,
      updatedAt: 2_000,
      commandActions: [
        {
          type: "read",
          command: "",
          name: "read",
          path: "src/renderer/features/local-conversation/view/local-conversation-thread-turn.tsx",
        },
      ],
      toolCall: {
        subtype: "command",
        toolName: "exec_command",
        args: {},
      },
    }),
    buildStoryConversationItem({
      turnId: "turn_story_historical_worked_for",
      itemId: "assistant_story_historical_worked_for",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      assistantPhase: "final_answer",
      markdownText: "Historical collapsed turns now show their worked duration.",
      createdAt: 3_000,
      updatedAt: 3_000,
    }),
  ],
});

const workingTurnStartedAtMs = Date.now() - 760_000;

const workingTurnActiveDivider = buildStoryConversationTurn({
  turnId: "turn_story_working_for_active",
  status: "inProgress",
  firstTurnWorkItemStartedAtMs: workingTurnStartedAtMs,
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_working_for_active",
      itemId: "user_story_working_for_active",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "Keep the running turn divider aligned with the captured main-surface fixture.",
      createdAt: workingTurnStartedAtMs - 2_000,
      updatedAt: workingTurnStartedAtMs - 2_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_working_for_active",
      itemId: "exec_story_working_for_active",
      type: "command_execution",
      kind: "commandExecution",
      semanticKind: "exec",
      status: "inProgress",
      createdAt: workingTurnStartedAtMs,
      updatedAt: workingTurnStartedAtMs,
      commandActions: [{ type: "unknown", command: "bun test" }],
      toolCall: {
        subtype: "command",
        toolName: "exec_command",
        args: {
          command: "bun test",
        },
      },
      aggregatedOutput: "Running tests...",
    }),
  ],
});

const imageDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

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
          sourceKind: "inline-image",
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
          sourceKind: "inline-image",
          caption: "first.png",
        },
        {
          type: "image",
          id: "user_story_mixed_attachments:attachment:image:2",
          source: imageDataUrl,
          sourceKind: "inline-image",
          caption: "second.png",
        },
        {
          type: "image",
          id: "user_story_mixed_attachments:attachment:image:3",
          source: imageDataUrl,
          sourceKind: "inline-image",
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

const longUserMessageTurn = buildStoryConversationTurn({
  turnId: "turn_story_long_user_message",
  status: "completed",
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_long_user_message",
      itemId: "user_story_long_user_message",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: Array.from(
        { length: 24 },
        (_value, index) =>
          `Review checkpoint ${index + 1}: keep the transcript bubble readable while preserving the complete prompt for copy, edit, and search.`,
      ).join("\n"),
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_long_user_message",
      itemId: "assistant_story_long_user_message",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      assistantPhase: "final_answer",
      markdownText: "The long prompt remains available behind the local Show more control.",
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
  ],
});

const multilineUserMessageTurn = buildStoryConversationTurn({
  turnId: "turn_story_multiline_user_message",
  status: "completed",
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_multiline_user_message",
      itemId: "user_story_multiline_user_message",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: [
        "Keep this formatting intact:",
        "",
        "1. Preserve blank lines.",
        "2. Preserve wrapped prose inside the bubble.",
        "3. Collapse only after real measured height exceeds the threshold.",
        "",
        ...Array.from({ length: 20 }, (_value, index) => `Additional preserved line ${index + 1}`),
      ].join("\n"),
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_multiline_user_message",
      itemId: "assistant_story_multiline_user_message",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      assistantPhase: "final_answer",
      markdownText: "The multiline message keeps its spacing when expanded.",
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
  ],
});

const veryLargeUserMessageTurn = buildStoryConversationTurn({
  turnId: "turn_story_very_large_user_message",
  status: "completed",
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_very_large_user_message",
      itemId: "user_story_very_large_user_message",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: Array.from(
        { length: 1_200 },
        (_value, index) =>
          `Exact legacy prompt line ${index + 1}: preserve full source without mounting every line in the transcript.`,
      ).join("\n"),
      createdAt: 1_000,
      updatedAt: 1_000,
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
          sourceKind: "remote-pointer",
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

const steeringParityTurn = buildStoryConversationTurn({
  turnId: "turn_story_steering_parity",
  status: "inProgress",
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_steering_parity",
      itemId: "user_story_steering_parity",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "Refine the thread composer steering behavior.",
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_steering_parity",
      itemId: "assistant_story_steering_parity",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      status: "inProgress",
      markdownText: "I am updating the active turn.",
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_steering_parity",
      itemId: "steer_story_pending",
      entryId: "steer_story_pending",
      type: "steeringUserMessage",
      kind: "userMessage",
      semanticKind: "userMessage",
      status: "completed",
      role: "user",
      markdownText: "Use the same queue/steer decision as Codex Electron.",
      steeringStatus: "pending",
      createdAt: 3_000,
      updatedAt: 3_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_steering_parity",
      itemId: "steer_story_accepted",
      entryId: "steer_story_accepted",
      type: "steeringUserMessage",
      kind: "userMessage",
      semanticKind: "userMessage",
      status: "completed",
      role: "user",
      markdownText: "After acceptance, keep the steering bubble visually plain.",
      steeringStatus: "accepted",
      createdAt: 4_000,
      updatedAt: 4_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_steering_parity",
      itemId: "steered_story_accepted",
      entryId: "steered_story_accepted",
      type: "steered",
      kind: "systemEvent",
      semanticKind: "steered",
      status: "completed",
      markdownText: "Steered conversation",
      createdAt: 4_100,
      updatedAt: 4_100,
    }),
  ],
});

const collapsedSteeringMessagesTurn = buildStoryConversationTurn({
  turnId: "turn_story_collapsed_steering_messages",
  status: "completed",
  durationMs: 125_000,
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_collapsed_steering_messages",
      itemId: "user_story_collapsed_steering_messages",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "Align the completed thread transcript with the latest behavior.",
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_collapsed_steering_messages",
      itemId: "exec_story_before_steering",
      type: "command_execution",
      kind: "commandExecution",
      semanticKind: "exec",
      status: "completed",
      commandActions: [
        {
          type: "read",
          command: "",
          name: "src/thread.tsx",
          path: "src/thread.tsx",
        },
      ],
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_collapsed_steering_messages",
      itemId: "steer_story_collapsed_first",
      entryId: "steer_story_collapsed_first",
      type: "steeringUserMessage",
      kind: "userMessage",
      semanticKind: "userMessage",
      status: "completed",
      role: "user",
      markdownText: "Keep steering messages visible after collapsing the activity.",
      steeringStatus: "accepted",
      createdAt: 3_000,
      updatedAt: 3_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_collapsed_steering_messages",
      itemId: "steered_story_collapsed_first",
      entryId: "steered_story_collapsed_first",
      type: "steered",
      kind: "systemEvent",
      semanticKind: "steered",
      status: "completed",
      markdownText: "Steered conversation",
      createdAt: 3_100,
      updatedAt: 3_100,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_collapsed_steering_messages",
      itemId: "exec_story_after_steering",
      type: "command_execution",
      kind: "commandExecution",
      semanticKind: "exec",
      status: "completed",
      commandActions: [
        {
          type: "read",
          command: "",
          name: "src/activity.ts",
          path: "src/activity.ts",
        },
      ],
      createdAt: 4_000,
      updatedAt: 4_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_collapsed_steering_messages",
      itemId: "steer_story_collapsed_second",
      entryId: "steer_story_collapsed_second",
      type: "steeringUserMessage",
      kind: "userMessage",
      semanticKind: "userMessage",
      status: "completed",
      role: "user",
      markdownText: "Preserve their original order above the final answer.",
      steeringStatus: "accepted",
      createdAt: 5_000,
      updatedAt: 5_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_collapsed_steering_messages",
      itemId: "steered_story_collapsed_second",
      entryId: "steered_story_collapsed_second",
      type: "steered",
      kind: "systemEvent",
      semanticKind: "steered",
      status: "completed",
      markdownText: "Steered conversation",
      createdAt: 5_100,
      updatedAt: 5_100,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_collapsed_steering_messages",
      itemId: "assistant_story_collapsed_steering_messages",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      assistantPhase: "final_answer",
      status: "completed",
      markdownText: "The completed transcript now keeps both steering messages visible.",
      createdAt: 6_000,
      updatedAt: 6_000,
    }),
  ],
});

const worktreeInitTurn = buildStoryConversationTurn({
  turnId: "turn_story_worktree_init",
  status: "completed",
  durationMs: 10_000,
  items: [
    buildStoryConversationItem({
      turnId: "turn_story_worktree_init",
      itemId: "pending-worktree-story:1",
      type: "worktreeInit",
      kind: "systemEvent",
      semanticKind: "worktreeInit",
      status: "completed",
      rawItem: {
        id: "pending-worktree-story:1",
        type: "worktreeInit",
        worktreeOutputText: [
          "[info] Starting worktree creation",
          "Preparing worktree (detached HEAD ab60370)",
          "HEAD is now at ab60370 Preserve observation fields during ARC rehydration",
          "Worktree created at /workspace/.codex/worktrees/f5b2/nodex",
          "No local environment selected",
          "",
        ].join("\n"),
        setup: null,
      },
      createdAt: 1_000,
      updatedAt: 1_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_worktree_init",
      itemId: "user_story_worktree_init",
      type: "user_message",
      kind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: "hi",
      createdAt: 2_000,
      updatedAt: 2_000,
    }),
    buildStoryConversationItem({
      turnId: "turn_story_worktree_init",
      itemId: "assistant_story_worktree_init",
      type: "assistant_message",
      kind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      assistantPhase: "final_answer",
      markdownText: "Hi! What would you like to work on?",
      createdAt: 3_000,
      updatedAt: 3_000,
    }),
  ],
});

function storyEntry(
  turn: CodexConversationTurn,
  isMostRecentTurn = true,
): VisibleConversationTurnEntry {
  const turnKey = turn.turnId ?? "turn-index-0";
  return {
    turn,
    turnId: turn.turnId,
    turnKey,
    turnSearchKey: turnKey,
    requests: [],
    isMostRecentTurn,
  };
}

function ControlledTurnEntry(props: ComponentProps<typeof LocalConversationTurnEntry>) {
  const [collapsed, setCollapsed] = useState<boolean | undefined>(undefined);
  return (
    <LocalConversationTurnEntry
      {...props}
      persistedCollapsed={collapsed}
      onSetCollapsed={setCollapsed}
    />
  );
}

function AutoOpenButtons({
  buttonLabels,
  ...props
}: ComponentProps<typeof LocalConversationTurnEntry> & { buttonLabels: readonly string[] }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonSequence = buttonLabels.join("\0");

  useEffect(() => {
    const labels = buttonSequence.split("\0");
    let attemptsRemaining = 20;
    let currentLabelIndex = 0;
    let timeoutId = 0;
    const open = () => {
      const buttonLabel = labels[currentLabelIndex];
      if (buttonLabel === undefined) return;
      const button = Array.from(rootRef.current?.querySelectorAll("button") ?? []).find(
        (candidate) => candidate.textContent?.trim() === buttonLabel,
      );
      if (button) {
        button.click();
        currentLabelIndex += 1;
      }
      attemptsRemaining -= 1;
      if (currentLabelIndex < labels.length && attemptsRemaining > 0) {
        timeoutId = window.setTimeout(open, 50);
      }
    };
    timeoutId = window.setTimeout(open, 50);
    return () => window.clearTimeout(timeoutId);
  }, [buttonSequence]);

  return (
    <div ref={rootRef}>
      <ControlledTurnEntry {...props} />
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Turn Entry",
  component: LocalConversationTurnEntry,
  args: {
    conversationId: "thread_storybook",
    entry: storyEntry(longThreadTurn),
    cwd: "/workspace/nodex",
    canEditTurnUserPrefix: true,
    canForkTurn: true,
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
    entry: storyEntry(assistantThenExecTurn),
  },
};

export const StoppedToolGroupBeforeActions: Story = {
  args: {
    entry: storyEntry(stoppedToolGroupBeforeActionsTurn),
    canEditTurnUserPrefix: false,
    canForkTurn: true,
  },
  decorators: [
    (Story) => (
      <div className="thread-stopped-tool-group-before-actions-story">
        <style>
          {".thread-stopped-tool-group-before-actions-story .opacity-0{opacity:1!important}"}
        </style>
        <Story />
      </div>
    ),
  ],
};

export const V2MaximalActivityUnits: Story = {
  args: {
    entry: storyEntry(v2MaximalActivityUnitsTurn, false),
    canEditTurnUserPrefix: false,
    canForkTurn: false,
  },
};

export const ActionStripParity: Story = {
  args: {
    entry: storyEntry(longThreadTurn, false),
    canEditTurnUserPrefix: true,
    canForkTurn: true,
  },
  decorators: [
    (Story) => (
      <div className="thread-action-strip-story">
        <style>{".thread-action-strip-story .opacity-0{opacity:1!important}"}</style>
        <Story />
      </div>
    ),
  ],
};

export const AssistantAfterDiffBeforeActions: Story = {
  args: {
    entry: storyEntry(assistantAfterDiffTurn),
    canEditTurnUserPrefix: false,
    canForkTurn: true,
  },
  decorators: [
    (Story) => (
      <div className="thread-action-strip-story">
        <style>{".thread-action-strip-story .opacity-0{opacity:1!important}"}</style>
        <Story />
      </div>
    ),
  ],
};

export const HistoricalWorkedForCollapsed: Story = {
  args: {
    entry: storyEntry(historicalWorkedForTurn, false),
    persistedCollapsed: true,
    canEditTurnUserPrefix: false,
    canForkTurn: true,
  },
};

export const WorkingTurnActiveDivider: Story = {
  args: {
    entry: storyEntry(workingTurnActiveDivider),
    canEditTurnUserPrefix: false,
    canForkTurn: true,
  },
};

export const SingleLocalImage: Story = {
  args: {
    entry: storyEntry(singleLocalImageTurn),
  },
};

export const MixedAttachments: Story = {
  args: {
    entry: storyEntry(mixedAttachmentTurn),
  },
};

export const LongUserMessageCollapsed: Story = {
  args: {
    entry: storyEntry(longUserMessageTurn),
  },
};

export const LongUserMessageExpanded: Story = {
  args: {
    entry: storyEntry(longUserMessageTurn),
  },
  render: (args) => <AutoOpenButtons {...args} buttonLabels={["Show more"]} />,
};

export const VeryLargeUserMessageFullSource: Story = {
  args: {
    entry: storyEntry(veryLargeUserMessageTurn),
  },
  render: (args) => <AutoOpenButtons {...args} buttonLabels={["View full message"]} />,
};

export const MultilineUserMessageCollapsed: Story = {
  args: {
    entry: storyEntry(multilineUserMessageTurn),
  },
};

export const RemoteImageLoading: Story = {
  args: {
    entry: storyEntry(remoteImageTurn),
  },
};

export const SteeringParity: Story = {
  args: {
    entry: storyEntry(steeringParityTurn),
    canEditTurnUserPrefix: false,
    canForkTurn: false,
  },
};

export const CollapsedSteeringMessages: Story = {
  args: {
    entry: storyEntry(collapsedSteeringMessagesTurn, false),
    canEditTurnUserPrefix: false,
    canForkTurn: false,
  },
  render: (args) => <ControlledTurnEntry {...args} />,
};

export const WorktreeInitialization: Story = {
  args: {
    entry: storyEntry(worktreeInitTurn),
    canEditTurnUserPrefix: false,
    canForkTurn: false,
  },
  render: (args) => <ControlledTurnEntry {...args} />,
};

export const WorktreeInitializationExpanded: Story = {
  args: WorktreeInitialization.args,
  render: (args) => (
    <AutoOpenButtons {...args} buttonLabels={["Worked for 10s", "Worktree created"]} />
  ),
};
