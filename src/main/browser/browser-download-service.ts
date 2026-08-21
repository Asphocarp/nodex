import { basename, extname, join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  BrowserDownloadActionRequest,
  BrowserDownloadActionResult,
  BrowserDownloadRecord,
  BrowserDownloadsSnapshot,
} from "../../shared/browser-download";
import type { BrowserSidebarTabIdentity } from "../../shared/browser-sidebar";
import type { BrowserDownloadStore } from "./browser-download-store";

interface BrowserDownloadItem {
  canResume(): boolean;
  cancel(): void;
  getFilename(): string;
  getReceivedBytes(): number;
  getTotalBytes(): number;
  getURLChain(): string[];
  isPaused(): boolean;
  on(
    event: "updated",
    listener: (event: unknown, state: "progressing" | "interrupted") => void,
  ): void;
  on(
    event: "done",
    listener: (event: unknown, state: "completed" | "cancelled" | "interrupted") => void,
  ): void;
  pause(): void;
  resume(): void;
  setSavePath(path: string): void;
}

interface BrowserDownloadSession {
  on(
    event: "will-download",
    listener: (
      event: { preventDefault(): void },
      item: BrowserDownloadItem,
      webContents: { id: number },
    ) => void,
  ): void;
}

interface BrowserDownloadShell {
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
}

interface BrowserDownloadServiceOptions {
  downloadsDirectory: string;
  idFactory?: () => string;
  isAgentControlled?: (identity: BrowserSidebarTabIdentity) => boolean;
  now?: () => number;
  onSnapshot?: (snapshot: BrowserDownloadsSnapshot) => void;
  resolveIdentity: (webContentsId: number) => BrowserSidebarTabIdentity | null;
  shell: BrowserDownloadShell;
  store: BrowserDownloadStore;
}

interface BrowserDownloadGrant {
  expiresAt: number;
  identityKey: string;
  sourceUrl: string;
}

function identityKey(identity: BrowserSidebarTabIdentity): string {
  return (
    `${identity.browserConversationId}\0${identity.browserViewScopeId}` +
    `\0${identity.browserTabId}`
  );
}

function readSourceOrigin(item: BrowserDownloadItem): string {
  const sourceUrl = item.getURLChain().at(-1);
  if (!sourceUrl) return "unknown:";
  try {
    return new URL(sourceUrl).origin;
  } catch {
    return "unknown:";
  }
}

function safeDownloadFilename(value: string): string {
  const fileName = basename(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return fileName || "download";
}

function uniqueSavePath(downloadsDirectory: string, fileName: string): string {
  const initial = join(downloadsDirectory, fileName);
  if (!existsSync(initial)) return initial;
  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  for (let sequence = 1; sequence <= 10_000; sequence += 1) {
    const candidate = join(downloadsDirectory, `${stem} (${sequence})${extension}`);
    if (!existsSync(candidate)) return candidate;
  }
  return join(downloadsDirectory, `${stem}-${randomUUID()}${extension}`);
}

export class BrowserDownloadService {
  private readonly downloadsDirectory: string;
  private readonly idFactory: () => string;
  private readonly isAgentControlled: (identity: BrowserSidebarTabIdentity) => boolean;
  private readonly now: () => number;
  private readonly onSnapshot: (snapshot: BrowserDownloadsSnapshot) => void;
  private readonly resolveIdentity: BrowserDownloadServiceOptions["resolveIdentity"];
  private readonly shell: BrowserDownloadShell;
  private readonly store: BrowserDownloadStore;
  private readonly liveItems = new Map<string, BrowserDownloadItem>();
  private readonly records = new Map<string, BrowserDownloadRecord>();
  private readonly grants = new Map<string, BrowserDownloadGrant>();
  private initialized = false;

  constructor(options: BrowserDownloadServiceOptions) {
    this.downloadsDirectory = options.downloadsDirectory;
    this.idFactory = options.idFactory ?? randomUUID;
    this.isAgentControlled = options.isAgentControlled ?? (() => false);
    this.now = options.now ?? Date.now;
    this.onSnapshot = options.onSnapshot ?? (() => undefined);
    this.resolveIdentity = options.resolveIdentity;
    this.shell = options.shell;
    this.store = options.store;
  }

  async initialize(session: BrowserDownloadSession): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    for (const record of await this.store.list()) {
      this.records.set(record.id, record);
    }
    this.emitSnapshot();
    session.on("will-download", (event, item, webContents) => {
      this.handleWillDownload(event, item, webContents.id);
    });
  }

  grantAgentDownload(identity: BrowserSidebarTabIdentity, sourceUrl: string, ttlMs = 10_000): void {
    try {
      const parsed = new URL(sourceUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    } catch {
      return;
    }
    this.grants.set(identityKey(identity), {
      expiresAt: this.now() + Math.max(1, Math.min(ttlMs, 10_000)),
      identityKey: identityKey(identity),
      sourceUrl,
    });
  }

  snapshot(): BrowserDownloadsSnapshot {
    return {
      downloads: [...this.records.values()].sort((left, right) => right.startedAt - left.startedAt),
    };
  }

  async handleAction(request: BrowserDownloadActionRequest): Promise<BrowserDownloadActionResult> {
    const record = this.records.get(request.downloadId);
    if (!record) return { ok: false, message: "Download was not found" };
    const item = this.liveItems.get(request.downloadId);
    if (request.action === "pause") {
      if (!item) return { ok: false, message: "Download is not active" };
      item.pause();
      await this.updateRecord(record, { status: "paused" });
      return { ok: true };
    }
    if (request.action === "resume") {
      if (!item || !item.canResume()) {
        return { ok: false, message: "Download cannot be resumed" };
      }
      item.resume();
      await this.updateRecord(record, { status: "progressing" });
      return { ok: true };
    }
    if (request.action === "cancel") {
      if (!item) return { ok: false, message: "Download is not active" };
      item.cancel();
      return { ok: true };
    }
    if (request.action === "open") {
      const error = await this.shell.openPath(record.savePath);
      return error ? { ok: false, message: error.slice(0, 512) } : { ok: true };
    }
    if (request.action === "show-in-folder") {
      this.shell.showItemInFolder(record.savePath);
      return { ok: true };
    }
    this.liveItems.delete(request.downloadId);
    this.records.delete(request.downloadId);
    await this.store.remove(request.downloadId);
    this.emitSnapshot();
    return { ok: true };
  }

  async clearHistory(): Promise<void> {
    for (const downloadId of this.liveItems.keys()) {
      const record = this.records.get(downloadId);
      if (record?.status === "progressing" || record?.status === "starting") {
        continue;
      }
      this.liveItems.delete(downloadId);
      this.records.delete(downloadId);
    }
    for (const [downloadId, record] of [...this.records]) {
      if (record.status === "progressing" || record.status === "starting") {
        continue;
      }
      this.records.delete(downloadId);
      await this.store.remove(downloadId);
    }
    this.emitSnapshot();
  }

  private handleWillDownload(
    event: { preventDefault(): void },
    item: BrowserDownloadItem,
    webContentsId: number,
  ): void {
    const identity = this.resolveIdentity(webContentsId);
    const sourceUrlChain = item.getURLChain();
    const sourceOrigin = readSourceOrigin(item);
    if (!identity || !this.consumeAgentGrantIfRequired(identity, sourceUrlChain)) {
      event.preventDefault();
      item.cancel();
      return;
    }

    const now = this.now();
    const id = this.idFactory();
    const fileName = safeDownloadFilename(item.getFilename());
    const savePath = uniqueSavePath(this.downloadsDirectory, fileName);
    item.setSavePath(savePath);
    const record: BrowserDownloadRecord = {
      id,
      browserConversationId: identity.browserConversationId,
      browserViewScopeId: identity.browserViewScopeId,
      browserTabId: identity.browserTabId,
      fileName,
      savePath,
      sourceOrigin,
      status: "starting",
      receivedBytes: item.getReceivedBytes(),
      totalBytes: Math.max(0, item.getTotalBytes()),
      startedAt: now,
      updatedAt: now,
    };
    this.liveItems.set(id, item);
    this.records.set(id, record);
    void this.store.upsert(record);
    this.emitSnapshot();

    item.on("updated", (_updatedEvent, state) => {
      const current = this.records.get(id);
      if (!current) return;
      void this.updateRecord(current, {
        status: item.isPaused()
          ? "paused"
          : state === "interrupted"
            ? "interrupted"
            : "progressing",
        receivedBytes: item.getReceivedBytes(),
        totalBytes: Math.max(0, item.getTotalBytes()),
      });
    });
    item.on("done", (_doneEvent, state) => {
      const current = this.records.get(id);
      if (!current) return;
      this.liveItems.delete(id);
      void this.updateRecord(current, {
        status: state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: Math.max(0, item.getTotalBytes()),
        ...(state === "completed" ? { completedAt: this.now() } : {}),
      });
    });
  }

  private consumeAgentGrantIfRequired(
    identity: BrowserSidebarTabIdentity,
    sourceUrlChain: readonly string[],
  ): boolean {
    if (!this.isAgentControlled(identity)) return true;
    const key = identityKey(identity);
    const grant = this.grants.get(key);
    this.grants.delete(key);
    return Boolean(
      grant && grant.expiresAt >= this.now() && sourceUrlChain.includes(grant.sourceUrl),
    );
  }

  private async updateRecord(
    current: BrowserDownloadRecord,
    patch: Partial<BrowserDownloadRecord>,
  ): Promise<void> {
    const next = {
      ...current,
      ...patch,
      updatedAt: this.now(),
    };
    this.records.set(next.id, next);
    await this.store.upsert(next);
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.onSnapshot(this.snapshot());
  }
}

let configuredBrowserDownloadService: BrowserDownloadService | null = null;

export function configureBrowserDownloadService(service: BrowserDownloadService): void {
  configuredBrowserDownloadService = service;
}

export function getBrowserDownloadService(): BrowserDownloadService {
  if (!configuredBrowserDownloadService) {
    throw new Error("Browser download service is unavailable");
  }
  return configuredBrowserDownloadService;
}
