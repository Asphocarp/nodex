import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs/react";
import type { CodexReviewDiffCommentAttachment, ReviewDiffAnnotationSide } from "@/lib/types";
import {
  buildReviewDiffAnnotationKey,
  captureReviewDiffLocalHunkFromPatch,
  formatReviewDiffCommentLineLabel,
  mapReviewDiffAnnotationSideToPositionSide,
  REVIEW_DIFF_COMMENT_DRAFTS_STORAGE_KEY,
} from "../../shared/review-diff-comments";

export interface ReviewDiffDraft {
  key: string;
  path: string;
  side: ReviewDiffAnnotationSide;
  lineNumber: number;
  startSide?: ReviewDiffAnnotationSide;
  startLine?: number;
  text: string;
  localDiffHunk?: string;
}

export interface ReviewDiffAnnotationMetadata {
  kind: "draft" | "local-comment" | "model-comment";
  key: string;
  path: string;
  side: ReviewDiffAnnotationSide;
  lineNumber: number;
  startSide?: ReviewDiffAnnotationSide;
  startLine?: number;
  attachmentId?: string;
  title?: string;
  body?: string;
  readonly?: boolean;
}

export type ReviewDiffAnnotation = DiffLineAnnotation<ReviewDiffAnnotationMetadata>;

export function normalizeReviewDiffRange(range: SelectedLineRange): ReviewDiffDraft | null {
  const side = range.endSide ?? range.side;
  if (!side || range.end <= 0) return null;

  const startSide = range.side ?? side;
  const startLine = range.start > 0 ? range.start : range.end;
  return {
    key: buildReviewDiffAnnotationKey(side, range.end),
    path: "",
    side,
    lineNumber: range.end,
    startSide,
    startLine,
    text: "",
  };
}

export function createReviewDiffDraftFromRange(input: {
  range: SelectedLineRange;
  path: string;
  patchText: string;
}): ReviewDiffDraft | null {
  const draft = normalizeReviewDiffRange(input.range);
  if (!draft) return null;

  return {
    ...draft,
    path: input.path,
    localDiffHunk: captureReviewDiffLocalHunkFromPatch({
      patchText: input.patchText,
      side: draft.side,
      lineNumber: draft.lineNumber,
    }),
  };
}

export function createReviewDiffDraftFromLine(input: {
  side: ReviewDiffAnnotationSide;
  lineNumber: number;
  path: string;
  patchText: string;
}): ReviewDiffDraft {
  return {
    key: buildReviewDiffAnnotationKey(input.side, input.lineNumber),
    path: input.path,
    side: input.side,
    lineNumber: input.lineNumber,
    text: "",
    localDiffHunk: captureReviewDiffLocalHunkFromPatch({
      patchText: input.patchText,
      side: input.side,
      lineNumber: input.lineNumber,
    }),
  };
}

export function buildReviewDiffCommentAttachment(input: {
  id: string;
  sessionKey: string;
  draft: ReviewDiffDraft;
  text: string;
  createdAt: number;
}): CodexReviewDiffCommentAttachment {
  const endPositionSide = mapReviewDiffAnnotationSideToPositionSide(input.draft.side);
  const startPositionSide = input.draft.startSide
    ? mapReviewDiffAnnotationSideToPositionSide(input.draft.startSide)
    : undefined;
  const hasRange = Boolean(
    input.draft.startLine &&
    (input.draft.startLine !== input.draft.lineNumber ||
      (input.draft.startSide && input.draft.startSide !== input.draft.side)),
  );
  return {
    id: input.id,
    type: "comment",
    content: [
      {
        content_type: "text",
        text: input.text.trim(),
      },
    ],
    position: {
      side: endPositionSide,
      path: input.draft.path,
      line: input.draft.lineNumber,
      ...(hasRange && input.draft.startLine ? { start_line: input.draft.startLine } : {}),
      ...(hasRange ? { start_side: startPositionSide ?? endPositionSide } : {}),
    },
    ...(input.draft.localDiffHunk ? { localDiffHunk: input.draft.localDiffHunk } : {}),
    source: {
      kind: "review-diff",
      label: formatReviewDiffCommentLineLabel({
        side: input.draft.side,
        line: input.draft.lineNumber,
        ...(input.draft.startSide ? { startSide: input.draft.startSide } : {}),
        ...(input.draft.startLine ? { startLine: input.draft.startLine } : {}),
      }),
      sessionKey: input.sessionKey,
    },
    createdAt: input.createdAt,
  };
}

export function buildReviewDiffDraftAnnotation(draft: ReviewDiffDraft): ReviewDiffAnnotation {
  return {
    side: draft.side,
    lineNumber: draft.lineNumber,
    metadata: {
      kind: "draft",
      key: draft.key,
      path: draft.path,
      side: draft.side,
      lineNumber: draft.lineNumber,
      ...(draft.startSide ? { startSide: draft.startSide } : {}),
      ...(draft.startLine ? { startLine: draft.startLine } : {}),
    },
  };
}

export function shouldBlockReviewDiffDraft(input: {
  key: string;
  existingKeys: ReadonlySet<string>;
  draftKeys: ReadonlySet<string>;
}): boolean {
  return input.existingKeys.has(input.key) || input.draftKeys.has(input.key);
}

export function buildReviewDiffDraftStorageScope(input: {
  threadId: string | null;
  sourceKey: string;
  path: string;
}): string {
  return `${input.threadId ?? "no-thread"}:${input.sourceKey}:${input.path}`;
}

export function readReviewDiffDraftStorage(scope: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REVIEW_DIFF_COMMENT_DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const scoped = (parsed as Record<string, unknown>)[scope];
    if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) return {};
    return Object.fromEntries(
      Object.entries(scoped).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export function writeReviewDiffDraftStorage(scope: string, drafts: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(REVIEW_DIFF_COMMENT_DRAFTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    const root =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const next = {
      ...root,
      [scope]: drafts,
    };
    window.localStorage.setItem(REVIEW_DIFF_COMMENT_DRAFTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Draft persistence is best-effort and should never block review.
  }
}
