import { open, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { BrowserDownloadRecord } from "../../shared/browser-download";

const MAX_DOWNLOAD_RECORDS = 1_000;
const MAX_DOWNLOAD_STORE_BYTES = 16 * 1024 * 1024;

const BrowserDownloadRecordSchema = z.object({
  id: z.string().min(1).max(512),
  browserConversationId: z.string().min(1).max(512),
  browserViewScopeId: z.string().min(1).max(512),
  browserTabId: z.string().min(1).max(512),
  fileName: z.string().min(1).max(2_048),
  savePath: z.string().min(1).max(16_384),
  sourceOrigin: z.string().min(1).max(16_384),
  status: z.enum([
    "starting",
    "progressing",
    "paused",
    "completed",
    "cancelled",
    "interrupted",
  ]),
  receivedBytes: z.number().finite().nonnegative(),
  totalBytes: z.number().finite().nonnegative(),
  startedAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
  completedAt: z.number().finite().nonnegative().optional(),
  interruptReason: z.string().max(2_048).optional(),
}).strict();

const BrowserDownloadStoreFileSchema = z.object({
  schemaVersion: z.literal(1),
  downloads: z.array(BrowserDownloadRecordSchema).max(MAX_DOWNLOAD_RECORDS),
}).strict();

export interface BrowserDownloadStore {
  list(): Promise<BrowserDownloadRecord[]>;
  upsert(record: BrowserDownloadRecord): Promise<void>;
  remove(downloadId: string): Promise<void>;
  clear(): Promise<void>;
}

export class FileBrowserDownloadStore implements BrowserDownloadStore {
  private readonly records = new Map<string, BrowserDownloadRecord>();
  private loadPromise: Promise<void> | null = null;
  private writeQueue = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<BrowserDownloadRecord[]> {
    await this.ensureLoaded();
    return [...this.records.values()]
      .sort((left, right) => right.startedAt - left.startedAt);
  }

  async upsert(record: BrowserDownloadRecord): Promise<void> {
    await this.ensureLoaded();
    const parsed = BrowserDownloadRecordSchema.parse(record);
    this.records.set(parsed.id, parsed);
    this.enforceLimits();
    await this.persist();
  }

  async remove(downloadId: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.records.delete(downloadId)) return;
    await this.persist();
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();
    if (this.records.size === 0) return;
    this.records.clear();
    await this.persist();
  }

  private async ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.load();
    await this.loadPromise;
  }

  private async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }
    try {
      const parsed = BrowserDownloadStoreFileSchema.parse(JSON.parse(raw));
      for (const record of parsed.downloads) {
        this.records.set(record.id, record);
      }
      this.enforceLimits();
    } catch {
      await this.quarantineCorruptStore();
    }
  }

  private enforceLimits(): void {
    const records = [...this.records.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_DOWNLOAD_RECORDS);
    this.records.clear();
    for (const record of records) this.records.set(record.id, record);
    while (
      this.records.size > 0
      && Buffer.byteLength(JSON.stringify([...this.records.values()]))
        > MAX_DOWNLOAD_STORE_BYTES
    ) {
      const oldest = [...this.records.values()]
        .sort((left, right) => left.updatedAt - right.updatedAt)[0];
      if (!oldest) return;
      this.records.delete(oldest.id);
    }
  }

  private async persist(): Promise<void> {
    const write = async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = join(
        dirname(this.filePath),
        `.${basename(this.filePath)}.${process.pid}.${this.now()}.tmp`,
      );
      const payload = `${JSON.stringify({
        schemaVersion: 1,
        downloads: [...this.records.values()],
      }, null, 2)}\n`;
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(payload, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporaryPath, this.filePath);
        const directory = await open(dirname(this.filePath), "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      } finally {
        await rm(temporaryPath, { force: true });
      }
    };
    this.writeQueue = this.writeQueue.then(write, write);
    await this.writeQueue;
  }

  private async quarantineCorruptStore(): Promise<void> {
    try {
      await rename(this.filePath, `${this.filePath}.corrupt-${this.now()}`);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}
