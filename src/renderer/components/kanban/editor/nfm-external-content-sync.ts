export interface NfmExternalContentSyncInput {
  incomingContent: string;
  previousContent: string;
  lastEmittedContent: string;
  currentSerializedContent: string;
}

export function shouldReplaceNfmExternalContent({
  incomingContent,
  previousContent,
  lastEmittedContent,
  currentSerializedContent,
}: NfmExternalContentSyncInput): boolean {
  if (incomingContent === previousContent) return false;
  if (incomingContent === lastEmittedContent) return false;
  return incomingContent !== currentSerializedContent;
}
