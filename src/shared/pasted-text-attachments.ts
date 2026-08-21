import type { CodexLiveFileAttachment, CodexPastedTextAttachment } from "./types";

export const COMPOSER_PASTED_TEXT_MAX_BYTES = 10 * 1024 * 1024;

export interface CreatePastedTextAttachmentInput {
  readonly text: string;
  readonly hostId?: string;
}

export interface ReadPastedTextAttachmentInput {
  readonly file: CodexLiveFileAttachment;
}

export interface RemovePastedTextAttachmentInput {
  readonly file: CodexLiveFileAttachment;
}

export type CreatePastedTextAttachmentResult = CodexPastedTextAttachment;
