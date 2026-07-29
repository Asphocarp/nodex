import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type {
  BrowserHistoryRecord,
  BrowserHistorySnapshot,
} from "../../shared/browser-profile";

const MAX_HISTORY_ENTRIES = 10_000;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

const BrowserHistoryRecordSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  url: z.string().min(1).max(16_384),
  title: z.string().max(2_048),
  lastVisitedAt: z.number().finite().nonnegative(),
  visitCount: z.number().int().positive(),
}).strict();

const BrowserHistoryFileSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(BrowserHistoryRecordSchema).max(MAX_HISTORY_ENTRIES),
}).strict();

export interface BrowserHistoryStore {
  record(input: { url: string; title: string; visitedAt?: number }): Promise<void>;
  list(input?: { query?: string; limit?: number }): Promise<BrowserHistorySnapshot>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export class FileBrowserHistoryStore implements BrowserHistoryStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly entries = new Map<string, BrowserHistoryRecord>();
  private loadPromise: Promise<void> | null = null;
  private writeQueue = Promise.resolve();

  constructor(options: { filePath: string; now?: () => number }) {
    this.filePath = options.filePath;
    this.now = options.now ?? Date.now;
  }

  async record(input: {
    url: string;
    title: string;
    visitedAt?: number;
  }): Promise<void> {
    const url = normalizeHistoryUrl(input.url);
    if (!url) return;
    await this.ensureLoaded();
    const id = historyRecordId(url);
    const existing = this.entries.get(id);
    this.entries.set(id, BrowserHistoryRecordSchema.parse({
      id,
      url,
      title: input.title.slice(0, 2_048),
      lastVisitedAt: input.visitedAt ?? this.now(),
      visitCount: (existing?.visitCount ?? 0) + 1,
    }));
    this.enforceLimits();
    await this.persist();
  }

  async list(input: {
    query?: string;
    limit?: number;
  } = {}): Promise<BrowserHistorySnapshot> {
    await this.ensureLoaded();
    const query = input.query?.trim().toLocaleLowerCase() ?? "";
    const limit = Math.max(1, Math.min(1_000, input.limit ?? 200));
    const entries = [...this.entries.values()]
      .filter((entry) =>
        query.length === 0
        || entry.title.toLocaleLowerCase().includes(query)
        || entry.url.toLocaleLowerCase().includes(query)
      )
      .sort((left, right) => right.lastVisitedAt - left.lastVisitedAt)
      .slice(0, limit);
    return {
      entries,
      updatedAt: this.now(),
    };
  }

  async delete(id: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.entries.delete(id)) return;
    await this.persist();
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();
    if (this.entries.size === 0) return;
    this.entries.clear();
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.quarantine();
      return;
    }
    const result = BrowserHistoryFileSchema.safeParse(parsed);
    if (!result.success) {
      await this.quarantine();
      return;
    }
    for (const entry of result.data.entries) {
      if (historyRecordId(entry.url) !== entry.id) continue;
      this.entries.set(entry.id, entry);
    }
    this.enforceLimits();
  }

  private enforceLimits(): void {
    const ordered = [...this.entries.values()]
      .sort((left, right) => right.lastVisitedAt - left.lastVisitedAt)
      .slice(0, MAX_HISTORY_ENTRIES);
    this.entries.clear();
    for (const entry of ordered) this.entries.set(entry.id, entry);
    while (this.entries.size > 0 && encodedBytes(this.entries) > MAX_HISTORY_BYTES) {
      const oldest = [...this.entries.values()]
        .sort((left, right) => left.lastVisitedAt - right.lastVisitedAt)[0];
      if (!oldest) break;
      this.entries.delete(oldest.id);
    }
  }

  private async persist(): Promise<void> {
    const write = async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = join(
        dirname(this.filePath),
        `.${basename(this.filePath)}.${process.pid}.${this.now()}.tmp`,
      );
      const payload = `${JSON.stringify({
        schemaVersion: 1,
        entries: [...this.entries.values()],
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

  private async quarantine(): Promise<void> {
    try {
      await rename(this.filePath, `${this.filePath}.corrupt-${this.now()}`);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
}

function normalizeHistoryUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username
    || url.password
  ) {
    return null;
  }
  return url.href;
}

function historyRecordId(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function encodedBytes(
  entries: ReadonlyMap<string, BrowserHistoryRecord>,
): number {
  return Buffer.byteLength(JSON.stringify({
    schemaVersion: 1,
    entries: [...entries.values()],
  }));
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}
