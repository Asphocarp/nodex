import { describe, expect, test } from "bun:test";
import { resolveCodexSubagentDisplayName } from "./codex-subagent-display";
import type { CodexConversationChildMembership, CodexThreadSummary } from "./types";
import type { CodexMultiAgentReceiverThread } from "./codex-transcript-special-items";

describe("resolveCodexSubagentDisplayName", () => {
  test("prefers membership nickname over raw receiver thread ids", () => {
    const threadId = "019f3ce0-058c-7a51-8d13-6895cc7c4f6e";
    const membership: CodexConversationChildMembership = {
      threadId,
      parentThreadId: "thread-parent",
      role: "backgroundChild",
      actorName: threadId,
      thread: {
        nickname: "@Feynman",
        agentRole: "writer",
      },
    };
    const receiverThread: CodexMultiAgentReceiverThread = {
      threadId,
      thread: {
        displayName: threadId,
        nickname: null,
        model: null,
        agentRole: null,
      },
    };

    expect(resolveCodexSubagentDisplayName({ threadId, membership, receiverThread })).toBe("Feynman");
  });

  test("uses hydrated child summary nickname when opener payload is a uuid", () => {
    const threadId = "019f3ce0-c963-7a13-8d88-705e26cc1510";
    const childSummary: CodexThreadSummary = {
      threadId,
      projectId: null,
      source: { parentThreadId: "thread-parent" },
      ephemeral: false,
      threadSource: "subagent",
      agentNickname: "@Epicurus",
      agentRole: "runner",
      threadName: null,
      threadPreview: "Role/name: Command Runner",
      modelProvider: "openai",
      cwd: "/tmp/project",
      statusType: "idle",
      statusActiveFlags: [],
      threadRuntimeStatus: null,
      archived: false,
      createdAt: 1,
      updatedAt: 2,
      linkedAt: new Date(0).toISOString(),
    };

    expect(resolveCodexSubagentDisplayName({
      threadId,
      childSummary,
      fallbackDisplayName: threadId,
    })).toBe("Epicurus");
  });

  test("falls back to the conversation id when no friendly metadata exists", () => {
    expect(resolveCodexSubagentDisplayName({ threadId: "thread-child" })).toBe("thread-child");
  });
});
