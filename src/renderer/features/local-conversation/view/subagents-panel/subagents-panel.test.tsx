import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ThreadComposerShellBackgroundAgentRowModel } from "../../thread-stage-types";
import type { CodexThreadSummary } from "../../../../../shared/types";
import {
  buildSubagentsPanelMemberships,
  formatSubagentRelativeTime,
  SubagentsPanelOverviewContent,
} from "./subagents-panel";

function buildSummary(input: {
  agentPath: string | null;
  parentThreadId: string;
  threadId: string;
}): CodexThreadSummary {
  return {
    threadId: input.threadId,
    projectId: "project-1",
    source: { parentThreadId: input.parentThreadId },
    agentNickname: `@${input.threadId}`,
    agentPath: input.agentPath,
    threadName: null,
    threadPreview: "",
    modelProvider: "openai",
    cwd: "/tmp/project",
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: 10,
    updatedAt: 20,
    linkedAt: "2026-07-20T00:00:00.000Z",
  };
}

describe("buildSubagentsPanelMemberships", () => {
  test("includes nested source-discovered descendants in the root panel", () => {
    const direct = buildSummary({
      agentPath: "agents/direct",
      parentThreadId: "root",
      threadId: "direct",
    });
    const nested = buildSummary({
      agentPath: null,
      parentThreadId: "direct",
      threadId: "nested",
    });

    const memberships = buildSubagentsPanelMemberships({
      discoveredThreadIds: [direct.threadId, nested.threadId],
      memberships: [],
      rootThreadId: "root",
      summaries: { direct, nested },
    });

    expect(memberships.map((membership) => membership.threadId)).toEqual(["direct", "nested"]);
    expect(memberships[1]?.parentThreadId).toBe("direct");
    expect(memberships[1]?.showInlineActivity).toBe(true);
  });
});

function buildRow(
  index: number,
  status: "active" | "done",
): ThreadComposerShellBackgroundAgentRowModel {
  return {
    conversationId: `${status}-${index}`,
    parentConversationId: "root",
    parentTurnKey: "turn-root",
    displayName: `${status === "active" ? "Active" : "Done"} ${index}`,
    actorName: `Agent ${index}`,
    agentRole: null,
    spawnModel: null,
    status,
    statusSummary: status === "active" ? "checking files" : null,
    lastAssistantMessage: status === "done" ? `Completed ${index}` : null,
    lastAssistantMessageAtMs: status === "done" ? index : null,
    recencyAtMs: 100 - index,
    showInlineActivity: true,
    diffStats: null,
    role: "backgroundChild",
  };
}

describe("SubagentsPanelOverviewContent", () => {
  test("paginates active and done agents with Codex batch sizes", async () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, index) => buildRow(index + 1, "active")),
      ...Array.from({ length: 11 }, (_, index) => buildRow(index + 1, "done")),
    ];
    render(
      <SubagentsPanelOverviewContent
        rootThreadId="root"
        rows={rows}
        onSelect={() => undefined}
        onVisibleRowsChange={() => undefined}
      />,
    );

    expect(screen.getByText("Done · 11")).toBeTruthy();
    expect(screen.queryByText("Active 5")).toBeNull();
    expect(screen.queryByText("Done 11")).toBeNull();

    const showMoreButtons = screen.getAllByRole("button", { name: "Show more" });
    await act(async () => {
      fireEvent.click(showMoreButtons[0]!);
      fireEvent.click(showMoreButtons[1]!);
      await Promise.resolve();
    });

    expect(screen.getByText("Active 5")).toBeTruthy();
    expect(screen.getByText("Done 11")).toBeTruthy();
  });

  test("shows the active empty state and routes a completed row", async () => {
    const onSelect = vi.fn();
    const row = buildRow(1, "done");
    render(
      <SubagentsPanelOverviewContent
        rootThreadId="root"
        rows={[row]}
        onSelect={onSelect}
        onVisibleRowsChange={() => undefined}
      />,
    );

    expect(screen.getByText("No active subagents")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Done 1/u }));
      await Promise.resolve();
    });
    expect(onSelect).toHaveBeenCalledWith(row);
  });
});

describe("formatSubagentRelativeTime", () => {
  test("uses compact minute, hour, and day labels", () => {
    expect(formatSubagentRelativeTime(1_000, 1_500)).toBe("now");
    expect(formatSubagentRelativeTime(0, 22 * 60_000)).toBe("22m");
    expect(formatSubagentRelativeTime(0, 3 * 3_600_000)).toBe("3h");
    expect(formatSubagentRelativeTime(0, 2 * 86_400_000)).toBe("2d");
  });
});
