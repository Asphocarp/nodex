import { beforeEach, describe, expect, test } from "vitest";
import {
  clearLocalConversationVirtualizedTurnRestoreSnapshotsForTests,
  readLocalConversationVirtualizedTurnRestoreSnapshot,
  writeLocalConversationVirtualizedTurnRestoreSnapshot,
} from "./local-conversation-virtualized-turn-restore-store";

describe("local conversation virtualized turn restore store", () => {
  beforeEach(() => {
    clearLocalConversationVirtualizedTurnRestoreSnapshotsForTests();
  });

  test("stores the bottom-distance, rendered window, measured heights, and latest-turn state by thread", () => {
    writeLocalConversationVirtualizedTurnRestoreSnapshot("thread_1", {
      distanceFromBottomPx: 5365,
      latestTurn: {
        followState: { followMode: "prework_watch" },
        latestTurnFollowContentHeightPx: 320,
        latestTurnHeightPx: 480,
        turnKey: "turn_latest",
      },
      virtualizedTurnList: {
        renderedWindow: { anchorKey: "turn_4", count: 7 },
        turnHeightsByKey: { turn_4: 300 },
      },
    });

    const snapshot = readLocalConversationVirtualizedTurnRestoreSnapshot("thread_1");
    expect(snapshot?.distanceFromBottomPx ?? 0).toBe(5365);
    expect(snapshot?.latestTurn?.followState.followMode ?? "").toBe("prework_watch");
    expect(snapshot?.latestTurn?.latestTurnFollowContentHeightPx ?? 0).toBe(320);
    expect(snapshot?.virtualizedTurnList?.renderedWindow.anchorKey ?? "").toBe("turn_4");
    expect(snapshot?.virtualizedTurnList?.turnHeightsByKey.turn_4 ?? 0).toBe(300);
  });

  test("keeps only the most recent fifty thread snapshots", () => {
    for (let index = 1; index <= 51; index += 1) {
      writeLocalConversationVirtualizedTurnRestoreSnapshot(`thread_${index}`, {
        distanceFromBottomPx: index,
        latestTurn: null,
        virtualizedTurnList: null,
      });
    }

    expect(readLocalConversationVirtualizedTurnRestoreSnapshot("thread_1") === null).toBe(true);
    expect(
      readLocalConversationVirtualizedTurnRestoreSnapshot("thread_51")?.distanceFromBottomPx ?? 0,
    ).toBe(51);
  });
});
