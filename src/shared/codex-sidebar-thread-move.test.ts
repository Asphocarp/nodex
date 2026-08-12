import { describe, expect, test } from "vitest";
import {
  CodexSidebarChatsThreadOrderInputSchema,
  CodexSidebarThreadMoveInputSchema,
  CodexSidebarProjectThreadOrderInputSchema,
  codexSidebarProjectThreadContainerId,
  isCodexSidebarThreadContainerId,
  readCodexSidebarProjectContainerId,
  readCodexSidebarThreadContainerLocation,
} from "./codex-sidebar-thread-move";

function makeMove(placement: Record<string, unknown>) {
  return {
    hostId: "local",
    threadId: "thread-1",
    sourceContainerId: "project:alpha",
    targetContainerId: "project:beta",
    ...placement,
  };
}

describe("Codex sidebar thread move contract", () => {
  test("accepts each exact placement variant", () => {
    expect(CodexSidebarThreadMoveInputSchema.safeParse(makeMove({
      beforeThreadId: "thread-2",
    })).success).toBe(true);
    expect(CodexSidebarThreadMoveInputSchema.safeParse(makeMove({
      beforeThreadId: null,
      insertAtEnd: true,
    })).success).toBe(true);
    expect(CodexSidebarThreadMoveInputSchema.safeParse(makeMove({
      beforeThreadId: null,
      useDefaultOrder: true,
    })).success).toBe(true);
    expect(CodexSidebarThreadMoveInputSchema.safeParse(makeMove({
      beforeThreadId: null,
    })).success).toBe(true);
  });

  test("rejects ambiguous placement and malformed containers", () => {
    expect(CodexSidebarThreadMoveInputSchema.safeParse(makeMove({
      beforeThreadId: null,
      insertAtEnd: true,
      useDefaultOrder: true,
    })).success).toBe(false);
    expect(CodexSidebarThreadMoveInputSchema.safeParse({
      ...makeMove({ beforeThreadId: null }),
      targetContainerId: "project:",
    }).success).toBe(false);
  });

  test("accepts only a bounded, revision-fenced Project access grant", () => {
    expect(CodexSidebarThreadMoveInputSchema.safeParse({
      ...makeMove({ beforeThreadId: null }),
      projectAccessGrant: {
        targetProjectId: "beta",
        expectedBindingRevision: 3,
        missingProjectSources: ["/repo/alpha"],
      },
    }).success).toBe(true);
    expect(CodexSidebarThreadMoveInputSchema.safeParse({
      ...makeMove({ beforeThreadId: null }),
      projectAccessGrant: {
        targetProjectId: "beta",
        expectedBindingRevision: 0,
        missingProjectSources: [],
      },
    }).success).toBe(false);
  });

  test("projects every local container onto orthogonal membership and pin lanes", () => {
    expect(isCodexSidebarThreadContainerId("project:alpha")).toBe(true);
    expect(isCodexSidebarThreadContainerId("project-pinned:alpha")).toBe(true);
    expect(isCodexSidebarThreadContainerId("project:")).toBe(false);
    expect(isCodexSidebarThreadContainerId("project-pinned:")).toBe(false);
    expect(readCodexSidebarProjectContainerId("project:alpha")).toBe("alpha");
    expect(readCodexSidebarProjectContainerId("project-pinned:alpha")).toBe("alpha");
    expect(readCodexSidebarProjectContainerId("pinned")).toBe(null);
    expect(readCodexSidebarProjectContainerId("reorder-only:alpha")).toBe(null);
    expect(readCodexSidebarThreadContainerLocation("pinned")).toEqual({
      projectId: null,
      pinned: true,
    });
    expect(readCodexSidebarThreadContainerLocation("chats")).toEqual({
      projectId: null,
      pinned: false,
    });
    expect(readCodexSidebarThreadContainerLocation("project-pinned:alpha")).toEqual({
      projectId: "alpha",
      pinned: true,
    });
    expect(readCodexSidebarThreadContainerLocation("project:alpha")).toEqual({
      projectId: "alpha",
      pinned: false,
    });
    expect(readCodexSidebarThreadContainerLocation("cloud")).toBe(null);
    expect(codexSidebarProjectThreadContainerId("alpha", true)).toBe("project-pinned:alpha");
    expect(codexSidebarProjectThreadContainerId("alpha", false)).toBe("project:alpha");
  });

  test("validates project custom-order writes and reset", () => {
    expect(CodexSidebarProjectThreadOrderInputSchema.safeParse({
      projectId: "alpha",
      orderedThreadIds: ["thread-2", "thread-1"],
    }).success).toBe(true);
    expect(CodexSidebarProjectThreadOrderInputSchema.safeParse({
      projectId: "alpha",
      orderedThreadIds: null,
    }).success).toBe(true);
  });

  test("validates exact global and Chats-visible manual-order inputs", () => {
    expect(CodexSidebarChatsThreadOrderInputSchema.safeParse({
      threadIdsInDisplayOrder: ["project-thread", "chat-a", "chat-b"],
      visibleThreadIds: ["chat-a", "chat-b"],
      nextVisibleThreadIds: ["chat-b", "chat-a"],
    }).success).toBe(true);
    expect(CodexSidebarChatsThreadOrderInputSchema.safeParse({
      threadIdsInDisplayOrder: ["chat-a"],
      visibleThreadIds: [""],
      nextVisibleThreadIds: ["chat-a"],
    }).success).toBe(false);
  });
});
