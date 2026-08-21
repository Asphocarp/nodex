import { describe, expect, test } from "vitest";
import type { CodexConversationSnapshot, CodexConversationTurn } from "../../../lib/types";
import {
  buildThreadSummaryPanelSideChatRow,
  isThreadSummarySideChatResponseInProgress,
} from "./thread-summary-panel-side-chat-row-model";

function makeConversation(
  overrides: Partial<
    Pick<CodexConversationSnapshot, "statusType" | "statusActiveFlags" | "turns">
  > = {},
): Pick<CodexConversationSnapshot, "statusType" | "statusActiveFlags" | "turns"> {
  return {
    statusType: "idle",
    statusActiveFlags: [],
    turns: [],
    ...overrides,
  } as Pick<CodexConversationSnapshot, "statusType" | "statusActiveFlags" | "turns">;
}

describe("buildThreadSummaryPanelSideChatRow", () => {
  test("projects the side-chat row identity and conversation response state", () => {
    const row = buildThreadSummaryPanelSideChatRow(
      {
        id: "sidechat:thread-side",
        title: "Investigate layout",
        threadId: "thread-side",
        panelId: "right",
        leafId: "leaf-a",
      },
      makeConversation({ statusType: "active" }),
    );

    expect(row.id).toBe("sidechat:thread-side");
    expect(row.title).toBe("Investigate layout");
    expect(row.isResponseInProgress).toBe(true);
    expect(row.panelId).toBe("right");
    expect(row.leafId).toBe("leaf-a");
  });

  test("does not treat a tab without a loaded conversation as response-in-progress", () => {
    const row = buildThreadSummaryPanelSideChatRow(
      {
        id: "sidechat-loading:thread-main:1",
        title: "Side chat",
        threadId: null,
        panelId: "bottom",
      },
      null,
    );

    expect(row.isResponseInProgress).toBe(false);
    expect(row.leafId).toBe(null);
  });
});

describe("isThreadSummarySideChatResponseInProgress", () => {
  test("uses conversation activity instead of panel-tab loading state", () => {
    const inProgressTurn = [
      {
        turnId: "turn-live",
        status: "inProgress",
        items: [],
      },
    ] as unknown as CodexConversationTurn[];

    expect(isThreadSummarySideChatResponseInProgress(null)).toBe(false);
    expect(isThreadSummarySideChatResponseInProgress(makeConversation())).toBe(false);
    expect(
      isThreadSummarySideChatResponseInProgress(makeConversation({ statusType: "active" })),
    ).toBe(true);
    expect(
      isThreadSummarySideChatResponseInProgress(
        makeConversation({ statusActiveFlags: ["waitingOnUserInput"] }),
      ),
    ).toBe(true);
    expect(
      isThreadSummarySideChatResponseInProgress(makeConversation({ turns: inProgressTurn })),
    ).toBe(true);
  });
});
