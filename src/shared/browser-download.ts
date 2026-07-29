export type BrowserDownloadStatus =
  | "starting"
  | "progressing"
  | "paused"
  | "completed"
  | "cancelled"
  | "interrupted";

export interface BrowserDownloadRecord {
  id: string;
  browserConversationId: string;
  browserViewScopeId: string;
  browserTabId: string;
  fileName: string;
  savePath: string;
  sourceOrigin: string;
  status: BrowserDownloadStatus;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  interruptReason?: string;
}

export interface BrowserDownloadsSnapshot {
  downloads: BrowserDownloadRecord[];
}

export type BrowserDownloadAction =
  | "pause"
  | "resume"
  | "cancel"
  | "open"
  | "show-in-folder"
  | "remove";

export interface BrowserDownloadActionRequest {
  action: BrowserDownloadAction;
  downloadId: string;
}

export type BrowserDownloadActionResult =
  | { ok: true }
  | { ok: false; message: string };
