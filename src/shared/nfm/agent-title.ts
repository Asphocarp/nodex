import {
  canonicalizePortableRichText,
  MAX_PORTABLE_RICH_TEXT_BYTES,
  type PortableRichText,
  type PortableRichTextItem,
  type PortableRichTextStyles,
} from "../block-documents/portable-rich-text";
import { parseInlineContent } from "./parser-inline";
import { parseNfm } from "./parser";
import { serializeInlineContent } from "./serializer-inline";
import type { NfmInlineContent, NfmStyleSet } from "./types";

export class InlineMarkdownTitleError extends TypeError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InlineMarkdownTitleError";
  }
}

function portableStyles(styles: NfmStyleSet): PortableRichTextStyles {
  return {
    ...(styles.bold ? { bold: true } : {}),
    ...(styles.italic ? { italic: true } : {}),
    ...(styles.underline ? { underline: true } : {}),
    ...(styles.strikethrough ? { strikethrough: true } : {}),
    ...(styles.code ? { code: true } : {}),
    ...(styles.color ? { color: styles.color } : {}),
  };
}

function parseTitleInlineItems(markdown: string): NfmInlineContent[] {
  if (markdown.includes("\n") || markdown.includes("\r")) {
    throw new InlineMarkdownTitleError("Page title Markdown must be one line");
  }
  if (markdown.includes("\t")) {
    throw new InlineMarkdownTitleError("Page title Markdown cannot contain tabs");
  }
  if (new TextEncoder().encode(markdown).byteLength > MAX_PORTABLE_RICH_TEXT_BYTES) {
    throw new InlineMarkdownTitleError(
      `Page title Markdown must be at most ${MAX_PORTABLE_RICH_TEXT_BYTES} UTF-8 bytes`,
    );
  }
  if (markdown.trim().length === 0) {
    return parseInlineContent(markdown);
  }

  const blocks = parseNfm(markdown);
  const block = blocks[0];
  if (
    blocks.length !== 1
    || block?.type !== "paragraph"
    || block.children.length > 0
    || block.color !== undefined
  ) {
    throw new InlineMarkdownTitleError(
      "Page title Markdown accepts inline content, not Block syntax",
    );
  }
  return block.content;
}

function toPortableItem(item: NfmInlineContent): PortableRichTextItem {
  if (item.type === "text" || item.type === "link") {
    return { ...item, styles: portableStyles(item.styles) };
  }
  if (item.type === "threadMention" || item.type === "dateMention") {
    return item;
  }
  if (item.type === "linebreak") {
    throw new InlineMarkdownTitleError("Page title Markdown cannot contain line breaks");
  }
  throw new InlineMarkdownTitleError(
    `Page title Markdown does not support inline ${item.type}`,
  );
}

export function parseInlineMarkdownTitle(markdown: string): PortableRichText {
  try {
    return canonicalizePortableRichText(
      parseTitleInlineItems(markdown).map(toPortableItem),
    );
  } catch (error) {
    if (error instanceof InlineMarkdownTitleError) throw error;
    throw new InlineMarkdownTitleError(
      error instanceof Error ? error.message : "Page title Markdown is invalid",
      { cause: error },
    );
  }
}

function nfmStyles(styles: PortableRichTextStyles): NfmStyleSet {
  return { ...styles };
}

function toNfmItem(item: PortableRichTextItem): NfmInlineContent {
  if (item.type === "text" || item.type === "link") {
    return { ...item, styles: nfmStyles(item.styles) };
  }
  return item;
}

export function serializeInlineMarkdownTitle(value: PortableRichText): string {
  const canonical = canonicalizePortableRichText(value);
  const markdown = serializeInlineContent(canonical.map(toNfmItem));
  const reparsed = parseInlineMarkdownTitle(markdown);
  if (JSON.stringify(reparsed) !== JSON.stringify(canonical)) {
    throw new InlineMarkdownTitleError(
      "Page title cannot be represented losslessly as inline Markdown",
    );
  }
  return markdown;
}
