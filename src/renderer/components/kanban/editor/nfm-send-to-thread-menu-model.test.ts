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
  test("keeps new thread fixed and filters archived or ephemeral threads", () => {
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
    expect(rows[0]?.kind).toBe("new-thread");
    expect(rows[1]?.id).toBe("thread:newer");
    expect(rows[2]?.id).toBe("thread:older");
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
    expect(rows[0]?.kind).toBe("new-thread");
    expect(rows[1]?.id).toBe("thread:status-hit");
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
