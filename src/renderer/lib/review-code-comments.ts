import type { CodexConversationItem, CodexConversationSnapshot } from "./types";

export interface ReviewCodeComment {
  title: string;
  body: string;
  file: string;
  start: number | null;
  end: number | null;
  priority: number | null;
}

const CODE_COMMENT_DIRECTIVE_PATTERN = /::code-comment\{([^}]*)\}/g;
const CODE_COMMENT_ATTRIBUTE_PATTERN = /([a-zA-Z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g;

function parseNumberAttribute(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCodeCommentAttributes(rawAttributes: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of rawAttributes.matchAll(CODE_COMMENT_ATTRIBUTE_PATTERN)) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (!key) continue;
    attributes[key] = value;
  }
  return attributes;
}

export function parseReviewCodeComments(text: string): ReviewCodeComment[] {
  return Array.from(text.matchAll(CODE_COMMENT_DIRECTIVE_PATTERN)).flatMap((match) => {
    const attributes = parseCodeCommentAttributes(match[1] ?? "");
    const title = attributes.title?.trim() ?? "";
    const body = attributes.body?.trim() ?? "";
    const file = attributes.file?.trim() ?? "";
    if (!title || !body || !file) return [];

    return [{
      title,
      body,
      file,
      start: parseNumberAttribute(attributes.start),
      end: parseNumberAttribute(attributes.end),
      priority: parseNumberAttribute(attributes.priority),
    }];
  });
}

function collectStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") return;

  for (const nextValue of Object.values(value as Record<string, unknown>)) {
    collectStrings(nextValue, output, depth + 1);
  }
}

function collectConversationItemStrings(item: CodexConversationItem): string[] {
  const strings: string[] = [];
  collectStrings(item.rawItem, strings);
  collectStrings(item.markdownText, strings);
  collectStrings(item.additionalDetails, strings);
  return strings;
}

function isSameComment(left: ReviewCodeComment, right: ReviewCodeComment): boolean {
  return left.title === right.title
    && left.body === right.body
    && left.file === right.file
    && left.start === right.start
    && left.end === right.end
    && left.priority === right.priority;
}

export function extractReviewCodeCommentsFromConversation(
  conversation: CodexConversationSnapshot | null,
): ReviewCodeComment[] {
  if (!conversation) return [];

  const comments: ReviewCodeComment[] = [];
  for (const turn of conversation.turns) {
    for (const item of turn.items) {
      const itemComments = collectConversationItemStrings(item)
        .flatMap((text) => parseReviewCodeComments(text));
      for (const comment of itemComments) {
        if (comments.some((existing) => isSameComment(existing, comment))) continue;
        comments.push(comment);
      }
    }
  }
  return comments;
}

function normalizeCommentPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function filterReviewCodeCommentsForPath(
  comments: ReviewCodeComment[],
  displayPath: string,
): ReviewCodeComment[] {
  const normalizedDisplayPath = normalizeCommentPath(displayPath);
  return comments.filter((comment) => {
    const normalizedCommentPath = normalizeCommentPath(comment.file);
    return normalizedCommentPath === normalizedDisplayPath
      || normalizedCommentPath.endsWith(`/${normalizedDisplayPath}`)
      || normalizedDisplayPath.endsWith(`/${normalizedCommentPath}`);
  });
}
