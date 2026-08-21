import { describe, expect, test } from "vitest";
import type { CodexConversationChildMembership } from "@/lib/types";
import {
  resolveChildConversationIds,
  resolveEffectiveThreadStageSettings,
} from "./connected-thread-stage-model";

const liveThreadSettings = {
  model: "gpt-thread",
  reasoningEffort: "medium",
  collaborationMode: {
    mode: "plan",
    settings: {
      model: "gpt-thread",
      reasoning_effort: "medium",
      developer_instructions: null,
    },
  },
  personality: "pragmatic",
} as const;

const fallbackInput = {
  liveThreadSettings,
  liveMode: null,
  fallbackMode: "default",
  fallbackModel: "gpt-draft",
  fallbackReasoningEffort: "high",
  availableModes: [
    { mode: "default", name: "Default", model: null },
    { mode: "plan", name: "Plan", model: null },
  ],
} as const;

describe("resolveEffectiveThreadStageSettings", () => {
  test("prefers active conversation settings over shell fallbacks", () => {
    expect(resolveEffectiveThreadStageSettings({
      ...fallbackInput,
      activeThreadId: "thread_1",
    })).toEqual({
      selectedCollaborationMode: "plan",
      selectedModel: "gpt-thread",
      selectedReasoningEffort: "medium",
    });
  });

  test("uses shell fallbacks for new-thread drafts", () => {
    expect(resolveEffectiveThreadStageSettings({
      ...fallbackInput,
      activeThreadId: null,
    })).toEqual({
      selectedCollaborationMode: "default",
      selectedModel: "gpt-draft",
      selectedReasoningEffort: "high",
    });
  });
});

describe("resolveChildConversationIds", () => {
  test("returns unique non-active child conversations", () => {
    const membership = (threadId: string): CodexConversationChildMembership => ({
      threadId,
      parentThreadId: "thread_parent",
      role: "backgroundChild",
    });

    expect(resolveChildConversationIds("thread_parent", [
      membership(" thread_child "),
      membership("thread_child"),
      membership("thread_parent"),
      membership("  "),
      membership("thread_other"),
    ])).toStrictEqual(["thread_child", "thread_other"]);
  });
});
