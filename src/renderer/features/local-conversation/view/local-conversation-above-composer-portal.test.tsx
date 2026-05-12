import { describe, expect, test } from "bun:test";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { CodexConversationItem } from "../../../lib/types";
import { render, settleAsyncRender, textContent } from "../../../test/dom";
import type { ThreadTranscriptBlockModel } from "../thread-stage-types";
import {
  LocalConversationAboveComposerPortal,
  LocalConversationAboveComposerPortalHost,
} from "./local-conversation-above-composer-portal";

function buildTurnDiffBlock(): ThreadTranscriptBlockModel {
  const entry: CodexConversationItem = {
    threadId: "thread-portal",
    turnId: "turn-1",
    itemId: "turn-diff-live",
    entryId: "turn-diff-live",
    type: "turn_diff",
    kind: "systemEvent",
    semanticKind: "diff",
    status: "inProgress",
    rawItem: {
      type: "turn-diff",
      cwd: "/tmp/project",
      unifiedDiff: [
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
    },
    createdAt: 1,
    updatedAt: 2,
  };

  return {
    id: "turn-diff-live",
    turnId: "turn-1",
    createdAt: 1,
    updatedAt: 2,
    searchableText: "1 file changed",
    type: "turnDiff",
    entry,
  };
}

describe("LocalConversationAboveComposerPortal", () => {
  test("renders streaming turn diffs through the portal renderer", async () => {
    const { container } = render(
      <TooltipProvider>
        <LocalConversationAboveComposerPortalHost conversationId="thread-portal" />
        <LocalConversationAboveComposerPortal
          blocks={[buildTurnDiffBlock()]}
          isLatestTurn={true}
          isStreamingTurn={true}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    await settleAsyncRender();

    const host = container.querySelector("[data-above-composer-portal]");
    expect(host?.textContent?.includes("1 file changed") ?? false).toBeTrue();
    expect(host?.querySelector('[codex\\.turn_diff\\.state="in_progress"]') !== null).toBeTrue();
    expect(textContent(container).includes("1 file changed")).toBeTrue();
  });
});
