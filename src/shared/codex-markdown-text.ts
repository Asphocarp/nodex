import { fromMarkdown } from "mdast-util-from-markdown";
import { toString as markdownNodeToString } from "mdast-util-to-string";
import type { Nodes } from "mdast";

function isMarkdownBlockContainer(
  node: Nodes,
): node is Extract<Nodes, { type: "root" | "blockquote" | "list" | "listItem" }> {
  return (
    node.type === "root" ||
    node.type === "blockquote" ||
    node.type === "list" ||
    node.type === "listItem"
  );
}

function extractCodexMarkdownNodeText(node: Nodes): string {
  if (!isMarkdownBlockContainer(node)) {
    return markdownNodeToString(node);
  }

  return node.children.map((child) => extractCodexMarkdownNodeText(child)).join(" ");
}

function safeMarkdownFallback(markdown: string): string {
  return markdown
    .replace(/!?(\[)([^\]]*)(\])\([^)]*\)/g, "$2")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Shared Codex Markdown-to-plain-text projection for compact UI labels. */
export function projectCodexMarkdownToPlainText(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "";

  try {
    return extractCodexMarkdownNodeText(fromMarkdown(trimmed)).replace(/\s+/g, " ").trim();
  } catch {
    return safeMarkdownFallback(trimmed);
  }
}
