import type { CodexLiveFileAttachment } from "./types";

function codexLiveFileAttachmentKey(attachment: CodexLiveFileAttachment): string {
  return JSON.stringify([
    attachment.label,
    attachment.path,
    attachment.fsPath,
    attachment.startLine,
    attachment.endLine,
  ]);
}

/** Exact bundle `rH`: retain the first original object for each five-field identity. */
export function dedupeCodexLiveFileAttachments<T extends CodexLiveFileAttachment>(
  attachments: readonly T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const attachment of attachments) {
    const key = codexLiveFileAttachmentKey(attachment);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(attachment);
  }
  return result;
}
