import { describe, expect, test } from "bun:test";
import type { CodexThreadSummary } from "@/lib/types";
import {
  buildNfmSendToThreadRows,
  moveNfmSendToThreadFocusedRowId,
  resolveNfmSendToThreadFocusedRowId,
} from "./nfm-send-to-thread-menu-model";

function makeThread(input: Partial<CodexThreadSummary> & { threadId: string }): CodexThreadSummary {
  return {
    threadId: input.threadId,
    projectId: input.projectId ?? "project-1",
    source: null,
    threadName: input.threadName ?? null,
    threadPreview: input.threadPreview ?? "",
    modelProvider: "openai",
    cwd: input.cwd ?? null,
    statusType: input.statusType ?? "idle",
    statusActiveFlags: input.statusActiveFlags ?? [],
    archived: input.archived ?? false,
    createdAt: input.createdAt ?? 0,
    updatedAt: input.updatedAt ?? 0,
    linkedAt: input.linkedAt ?? "2026-01-01T00:00:00.000Z",
    ...(input.ephemeral !== undefined ? { ephemeral: input.ephemeral } : {}),
  };
}

describe("nfm send-to-thread menu model", () => {
  test("keeps New chat last and filters archived or ephemeral threads", () => {
    const rows = buildNfmSendToThreadRows({
      query: "",
      threads: [
        makeThread({ threadId: "older", threadName: "Older", updatedAt: 1 }),
        makeThread({ threadId: "newer", threadName: "Newer", updatedAt: 3 }),
        makeThread({ threadId: "archived", threadName: "Archived", archived: true, updatedAt: 4 }),
        makeThread({ threadId: "side", threadName: "Side", ephemeral: true, updatedAt: 5 }),
      ],
    });

    expect(rows.length).toBe(3);
    expect(rows[0]?.id).toBe("thread:newer");
    expect(rows[1]?.id).toBe("thread:older");
    expect(rows[2]?.kind).toBe("new-thread");
  });

  test("searches title, preview, cwd, status, and uuid", () => {
    const rows = buildNfmSendToThreadRows({
      query: "approval",
      threads: [
        makeThread({
          threadId: "status-hit",
          threadName: "Needs user review",
          statusActiveFlags: ["waitingOnApproval"],
          updatedAt: 2,
        }),
        makeThread({
          threadId: "miss",
          threadName: "Different",
          threadPreview: "No match",
          updatedAt: 1,
        }),
      ],
    });

    expect(rows.length).toBe(2);
    expect(rows[0]?.id).toBe("thread:status-hit");
    expect(rows[1]?.kind).toBe("new-thread");
  });

  test("uses the owning project label for ordinary thread row metadata", () => {
    const rows = buildNfmSendToThreadRows({
      query: "",
      projectNameById: {
        "project-1": "Launch project",
      },
      threads: [
        makeThread({ threadId: "ordinary", threadName: "Ordinary", updatedAt: 1 }),
      ],
    });

    expect(rows[0]?.kind).toBe("thread");
    if (rows[0]?.kind !== "thread") {
      throw new Error("expected thread row");
    }
    expect(rows[0].meta).toBe("Launch project");
  });

  test("pins and labels the preferred thread with caller meta when it matches the query", () => {
    const rows = buildNfmSendToThreadRows({
      query: "",
      preferredTarget: {
        kind: "thread",
        thread: makeThread({ threadId: "preferred", threadName: "Preferred", updatedAt: 1 }),
        meta: "Current section",
      },
      threads: [
        makeThread({ threadId: "newer", threadName: "Newer", updatedAt: 3 }),
        makeThread({ threadId: "preferred", threadName: "Preferred", updatedAt: 1 }),
      ],
    });

    expect(rows.length).toBe(3);
    expect(rows[0]?.id).toBe("thread:preferred");
    if (rows[0]?.kind !== "thread") {
      throw new Error("expected preferred thread row");
    }
    expect(rows[0].meta).toBe("Current section");
    expect(rows[0].isPreferredTarget).toBeTrue();
    expect(rows[1]?.id).toBe("thread:newer");
    expect(rows[2]?.kind).toBe("new-thread");
  });

  test("pins the current session new-chat target without duplicating the footer action", () => {
    const rows = buildNfmSendToThreadRows({
      query: "",
      preferredTarget: {
        kind: "new-thread",
        sessionId: "session-current",
        meta: "This session",
      },
      threads: [
        makeThread({ threadId: "newer", threadName: "Newer", updatedAt: 3 }),
        makeThread({ threadId: "older", threadName: "Older", updatedAt: 1 }),
      ],
    });

    expect(rows.length).toBe(3);
    expect(rows[0]?.id).toBe("new-thread:session-current");
    if (rows[0]?.kind !== "new-thread") {
      throw new Error("expected preferred new chat row");
    }
    expect(rows[0].label).toBe("New chat");
    expect(rows[0].meta).toBe("This session");
    expect(rows[0].isPreferredTarget).toBeTrue();
    expect(rows[0].isFooterAction).toBeFalse();
    expect(rows[0].target.sessionId).toBe("session-current");
    expect(rows[1]?.id).toBe("thread:newer");
    expect(rows[2]?.id).toBe("thread:older");
  });

  test("keeps the project new-chat footer when the preferred new-chat target does not match search", () => {
    const rows = buildNfmSendToThreadRows({
      query: "unrelated",
      preferredTarget: {
        kind: "new-thread",
        sessionId: "session-current",
        meta: "This session",
      },
      threads: [
        makeThread({ threadId: "other", threadName: "Other task", updatedAt: 1 }),
      ],
    });

    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe("new-thread");
    if (rows[0]?.kind !== "new-thread") {
      throw new Error("expected project new chat row");
    }
    expect(rows[0].meta).toBe("This project");
    expect(rows[0].isFooterAction).toBeTrue();
    expect(rows[0].target.sessionId ?? "").toBe("");
  });

  test("uses thread summaries over preferred fallback without duplicating rows", () => {
    const rows = buildNfmSendToThreadRows({
      query: "",
      preferredTarget: {
        kind: "thread",
        thread: makeThread({ threadId: "preferred", threadName: "Stale title", updatedAt: 1 }),
        meta: "This session",
      },
      threads: [
        makeThread({ threadId: "preferred", threadName: "Fresh title", updatedAt: 5 }),
      ],
    });

    expect(rows.length).toBe(2);
    expect(rows[0]?.id).toBe("thread:preferred");
    if (rows[0]?.kind !== "thread") {
      throw new Error("expected thread row");
    }
    expect(rows[0].label).toBe("Fresh title");
    expect(rows[0].meta).toBe("This session");
    expect(rows[1]?.kind).toBe("new-thread");
  });

  test("does not force the preferred thread into unrelated search results", () => {
    const rows = buildNfmSendToThreadRows({
      query: "other",
      preferredTarget: {
        kind: "thread",
        thread: makeThread({ threadId: "preferred", threadName: "Preferred", updatedAt: 10 }),
        meta: "This session",
      },
      threads: [
        makeThread({ threadId: "preferred", threadName: "Preferred", updatedAt: 10 }),
        makeThread({ threadId: "other", threadName: "Other task", updatedAt: 1 }),
      ],
    });

    expect(rows.length).toBe(2);
    expect(rows[0]?.id).toBe("thread:other");
    expect(rows[1]?.kind).toBe("new-thread");
  });

  test("does not pin archived or ephemeral preferred threads", () => {
    const rows = buildNfmSendToThreadRows({
      query: "",
      preferredTarget: {
        kind: "thread",
        thread: makeThread({ threadId: "preferred", threadName: "Preferred", archived: true, updatedAt: 10 }),
        meta: "Current section",
      },
      threads: [
        makeThread({ threadId: "preferred", threadName: "Preferred", archived: true, updatedAt: 10 }),
        makeThread({ threadId: "ephemeral", threadName: "Ephemeral", ephemeral: true, updatedAt: 9 }),
        makeThread({ threadId: "other", threadName: "Other", updatedAt: 1 }),
      ],
    });

    expect(rows.map((row) => row.id).join(",")).toBe("thread:other,new-thread");
  });

  test("focus starts on a matching existing thread for search and wraps during keyboard movement", () => {
    const rows = buildNfmSendToThreadRows({
      query: "build",
      threads: [
        makeThread({ threadId: "build-thread", threadName: "Build flow", updatedAt: 1 }),
      ],
    });

    const initial = resolveNfmSendToThreadFocusedRowId(null, "build", rows);
    expect(initial).toBe("thread:build-thread");
    expect(moveNfmSendToThreadFocusedRowId(initial, 1, rows)).toBe("new-thread");
    expect(moveNfmSendToThreadFocusedRowId("new-thread", -1, rows)).toBe("thread:build-thread");
  });
});
