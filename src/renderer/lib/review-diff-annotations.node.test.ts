import { describe, expect, test } from "vitest";
import {
  buildReviewDiffAnnotationKey,
  captureReviewDiffLocalHunkFromPatch,
  formatReviewDiffCommentLineLabel,
  mapReviewDiffAnnotationSideToPositionSide,
  serializeReviewDiffCommentAttachmentForPrompt,
} from "../../shared/review-diff-comments";
import {
  buildReviewDiffCommentAttachment,
  createReviewDiffDraftFromRange,
  shouldBlockReviewDiffDraft,
} from "./review-diff-annotations";

const PATCH = [
  "diff --git a/src/example.ts b/src/example.ts",
  "index 1111111..2222222 100644",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -8,3 +8,4 @@",
  " export const before = 1;",
  "-export const oldValue = 1;",
  "+export const newValue = 2;",
  "+export const added = true;",
  " export const after = 3;",
  "",
].join("\n");

describe("review diff annotations", () => {
  test("uses Codex side keys and line labels", () => {
    expect(buildReviewDiffAnnotationKey("additions", 12)).toBe("additions:12");
    expect(buildReviewDiffAnnotationKey("deletions", 8)).toBe("deletions:8");
    expect(mapReviewDiffAnnotationSideToPositionSide("additions")).toBe("right");
    expect(mapReviewDiffAnnotationSideToPositionSide("deletions")).toBe("left");
    expect(formatReviewDiffCommentLineLabel({ side: "deletions", line: 40 })).toBe("Comment on line L40");
    expect(formatReviewDiffCommentLineLabel({
      side: "additions",
      line: 12,
      startSide: "deletions",
      startLine: 10,
    })).toBe("Comment on lines L10 to R12");
  });

  test("captures the local unified diff hunk for the annotated side", () => {
    const hunk = captureReviewDiffLocalHunkFromPatch({
      patchText: PATCH,
      side: "additions",
      lineNumber: 10,
    });

    expect(Boolean(hunk?.startsWith("@@ -8,3 +8,4 @@"))).toBe(true);
    expect(Boolean(hunk?.includes("+export const added = true;"))).toBe(true);
  });

  test("builds request-change attachments from selected ranges", () => {
    const draft = createReviewDiffDraftFromRange({
      range: {
        side: "deletions",
        start: 9,
        endSide: "additions",
        end: 11,
      },
      path: "src/example.ts",
      patchText: PATCH,
    });

    expect(draft?.key).toBe("additions:11");
    const attachment = buildReviewDiffCommentAttachment({
      id: "comment_1",
      sessionKey: "source_1",
      draft: draft!,
      text: "Please adjust this",
      createdAt: 123,
    });

    expect(JSON.stringify(attachment.position)).toBe(JSON.stringify({
      side: "right",
      path: "src/example.ts",
      line: 11,
      start_line: 9,
      start_side: "left",
    }));
    expect(attachment.content[0]?.text).toBe("Please adjust this");
    expect(attachment.source?.label).toBe("Comment on lines L9 to R11");
  });

  test("serializes comments for Codex prompt input", () => {
    const draft = createReviewDiffDraftFromRange({
      range: {
        side: "additions",
        start: 10,
        end: 10,
      },
      path: "src/example.ts",
      patchText: PATCH,
    });
    const attachment = buildReviewDiffCommentAttachment({
      id: "comment_2",
      sessionKey: "source_2",
      draft: draft!,
      text: "Request change text",
      createdAt: 456,
    });
    const promptText = serializeReviewDiffCommentAttachmentForPrompt(attachment);

    expect(Boolean(promptText.includes("Review diff comment:"))).toBe(true);
    expect(Boolean(promptText.includes("File: src/example.ts"))).toBe(true);
    expect(Boolean(promptText.includes("Side: right"))).toBe(true);
    expect(Boolean(promptText.includes("Comment:\nRequest change text"))).toBe(true);
  });

  test("blocks duplicate drafts against existing comments and drafts", () => {
    expect(shouldBlockReviewDiffDraft({
      key: "additions:2",
      existingKeys: new Set(["additions:2"]),
      draftKeys: new Set(),
    })).toBe(true);
    expect(shouldBlockReviewDiffDraft({
      key: "deletions:3",
      existingKeys: new Set(),
      draftKeys: new Set(["deletions:3"]),
    })).toBe(true);
    expect(shouldBlockReviewDiffDraft({
      key: "additions:4",
      existingKeys: new Set(),
      draftKeys: new Set(),
    })).toBe(false);
  });
});
