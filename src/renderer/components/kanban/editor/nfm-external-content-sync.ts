export interface NfmExternalContentSyncInput {
  incomingContent: string;
  previousContent: string;
  lastEmittedContent: string;
  currentSerializedContent: string;
  hasActiveLocalEdit?: boolean;
}

export type NfmExternalContentSyncDecision =
  | {
    action: "skip";
    cancelPending: boolean;
  }
  | {
    action: "defer";
  }
  | {
    action: "replace";
  };

export interface NfmDeferredExternalContentSync {
  content: string;
  baselineSerializedContent: string;
  shouldReplayWhenSafe: boolean;
}

export interface NfmDeferredExternalContentSyncInput {
  deferred: NfmDeferredExternalContentSync;
  currentSerializedContent: string;
  hasActiveLocalEdit?: boolean;
}

export type NfmDeferredExternalContentSyncDecision =
  | {
    action: "keep-deferred";
  }
  | {
    action: "skip";
    cancelPending: boolean;
  }
  | {
    action: "drop";
  }
  | {
    action: "replace";
  };

export function resolveNfmExternalContentSyncDecision({
  incomingContent,
  previousContent,
  lastEmittedContent,
  currentSerializedContent,
  hasActiveLocalEdit = false,
}: NfmExternalContentSyncInput): NfmExternalContentSyncDecision {
  if (incomingContent === previousContent) {
    return { action: "skip", cancelPending: false };
  }
  if (incomingContent === lastEmittedContent) {
    return { action: "skip", cancelPending: false };
  }
  if (incomingContent === currentSerializedContent) {
    return { action: "skip", cancelPending: true };
  }
  if (hasActiveLocalEdit) {
    return { action: "defer" };
  }
  return { action: "replace" };
}

export function shouldReplaceNfmExternalContent(input: NfmExternalContentSyncInput): boolean {
  return resolveNfmExternalContentSyncDecision(input).action === "replace";
}

export function resolveNfmDeferredExternalContentSyncDecision({
  deferred,
  currentSerializedContent,
  hasActiveLocalEdit = false,
}: NfmDeferredExternalContentSyncInput): NfmDeferredExternalContentSyncDecision {
  if (hasActiveLocalEdit) {
    return { action: "keep-deferred" };
  }
  if (currentSerializedContent === deferred.content) {
    return { action: "skip", cancelPending: true };
  }
  if (!deferred.shouldReplayWhenSafe) {
    return { action: "drop" };
  }
  if (currentSerializedContent !== deferred.baselineSerializedContent) {
    return { action: "drop" };
  }
  return { action: "replace" };
}
