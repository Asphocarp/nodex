import { clampUnitInterval } from "./image-geometry";
import type { ImageComment, ImageCommentGroup } from "./types";

export type ImageCommentLocale = string | readonly string[];

export function formatImageCommentPercent(value: number, locales?: ImageCommentLocale): string {
  return new Intl.NumberFormat(locales, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(clampUnitInterval(value));
}

export function serializePositionedImageComment(args: {
  comment: ImageComment;
  commentNumber: number;
  locales?: ImageCommentLocale;
}): string {
  const x = formatImageCommentPercent(args.comment.x, args.locales);
  const y = formatImageCommentPercent(args.comment.y, args.locales);
  return `${args.commentNumber}. (x: ${x}, y: ${y}) ${args.comment.text}`;
}

/** Serializes image-space comments in stable image and creation order. */
export function serializeImageCommentGroups(args: {
  imageCommentGroups: readonly ImageCommentGroup[];
  locales?: ImageCommentLocale;
  prompt: string;
}): string {
  const sections = args.imageCommentGroups.map((group) =>
    [
      `Image ${group.imageNumber}:`,
      ...group.comments.map((comment, index) =>
        serializePositionedImageComment({
          comment,
          commentNumber: index + 1,
          locales: args.locales,
        }),
      ),
    ].join("\n"),
  );

  if (sections.length === 0) return args.prompt;

  const prompt = args.prompt.trim();
  if (prompt.length > 0) {
    sections.push(`Additional instructions:\n${prompt}`);
  }

  return sections.join("\n\n");
}
