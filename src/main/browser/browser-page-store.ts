import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { BrowserSidebarTabIdentity } from "../../shared/browser-sidebar";
import { BrowserSidebarTabIdentitySchema } from "../../shared/browser/browser-schemas";

const MAX_PAGE_COUNT = 100;
const MAX_NAVIGATION_ENTRIES = 500;
const MAX_STORE_BYTES = 64 * 1024 * 1024;
const MAX_URL_LENGTH = 16_384;
const MAX_TITLE_LENGTH = 2_048;
const MAX_PAGE_STATE_LENGTH = 2 * 1024 * 1024;

const BrowserNavigationEntrySchema = z
  .object({
    title: z.string().max(MAX_TITLE_LENGTH),
    url: z.string().max(MAX_URL_LENGTH),
    pageState: z.string().max(MAX_PAGE_STATE_LENGTH).optional(),
  })
  .strict();

const BrowserSerializedPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    runtime: z.literal("electron-webview"),
    browserStorageId: z.string().min(1).max(512),
    identity: BrowserSidebarTabIdentitySchema,
    faviconUrl: z.string().max(MAX_URL_LENGTH).optional(),
    title: z.string().max(MAX_TITLE_LENGTH),
    url: z.string().max(MAX_URL_LENGTH),
    updatedAt: z.number().finite().nonnegative(),
    navigation: z
      .object({
        currentIndex: z.number().int().nonnegative(),
        entries: z.array(BrowserNavigationEntrySchema).min(1).max(MAX_NAVIGATION_ENTRIES),
      })
      .strict(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.navigation.currentIndex < page.navigation.entries.length) return;
    context.addIssue({
      code: "custom",
      message: "Navigation currentIndex must reference an existing entry",
      path: ["navigation", "currentIndex"],
    });
  });

const BrowserPageStoreFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    pages: z.record(z.string(), BrowserSerializedPageSchema),
  })
  .strict();

export interface BrowserNavigationEntry {
  title: string;
  url: string;
  pageState?: string;
}

export interface BrowserSerializedPage {
  schemaVersion: 1;
  runtime: "electron-webview";
  browserStorageId: string;
  identity: BrowserSidebarTabIdentity;
  faviconUrl?: string;
  title: string;
  url: string;
  updatedAt: number;
  navigation: {
    currentIndex: number;
    entries: BrowserNavigationEntry[];
  };
}

export interface BrowserPageSnapshotStore {
  get(browserStorageId: string): Promise<BrowserSerializedPage | null>;
  set(page: BrowserSerializedPage): Promise<void>;
  delete(browserStorageId: string): Promise<void>;
  clear(): Promise<void>;
  reassociate(sourceStorageId: string, targetStorageId: string): Promise<void>;
}

export interface FileBrowserPageSnapshotStoreOptions {
  filePath: string;
  now?: () => number;
}

export class FileBrowserPageSnapshotStore implements BrowserPageSnapshotStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly pages = new Map<string, BrowserSerializedPage>();
  private loadPromise: Promise<void> | null = null;
  private writeQueue = Promise.resolve();

  constructor(options: FileBrowserPageSnapshotStoreOptions) {
    this.filePath = options.filePath;
    this.now = options.now ?? Date.now;
  }

  async get(browserStorageId: string): Promise<BrowserSerializedPage | null> {
    await this.ensureLoaded();
    return this.pages.get(browserStorageId) ?? null;
  }

  async set(page: BrowserSerializedPage): Promise<void> {
    await this.ensureLoaded();
    const normalized = normalizePage(page, this.now());
    this.pages.set(normalized.browserStorageId, normalized);
    this.enforceLimits();
    await this.persist();
  }

  async delete(browserStorageId: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.pages.delete(browserStorageId)) return;
    await this.persist();
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();
    if (this.pages.size === 0) return;
    this.pages.clear();
    await this.persist();
  }

  async reassociate(sourceStorageId: string, targetStorageId: string): Promise<void> {
    await this.ensureLoaded();
    const source = this.pages.get(sourceStorageId);
    if (!source) return;
    this.pages.delete(sourceStorageId);
    this.pages.set(targetStorageId, {
      ...source,
      browserStorageId: targetStorageId,
      updatedAt: this.now(),
    });
    this.enforceLimits();
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
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      await this.quarantineCorruptStore();
      return;
    }
    const result = BrowserPageStoreFileSchema.safeParse(parsedJson);
    if (!result.success) {
      await this.quarantineCorruptStore();
      return;
    }
    for (const [browserStorageId, page] of Object.entries(result.data.pages)) {
      if (browserStorageId !== page.browserStorageId) continue;
      this.pages.set(browserStorageId, page);
    }
    this.enforceLimits();
  }

  private enforceLimits(): void {
    const ordered = [...this.pages.values()].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
    this.pages.clear();
    for (const page of ordered.slice(0, MAX_PAGE_COUNT)) {
      this.pages.set(page.browserStorageId, page);
    }
    while (this.pages.size > 0 && encodedStoreBytes(this.pages) > MAX_STORE_BYTES) {
      const oldest = [...this.pages.values()].sort(
        (left, right) => left.updatedAt - right.updatedAt,
      )[0];
      if (!oldest) break;
      this.pages.delete(oldest.browserStorageId);
    }
  }

  private async persist(): Promise<void> {
    const write = async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = join(
        dirname(this.filePath),
        `.${basename(this.filePath)}.${process.pid}.${this.now()}.tmp`,
      );
      const payload = `${JSON.stringify(
        {
          schemaVersion: 1,
          pages: Object.fromEntries(this.pages),
        },
        null,
        2,
      )}\n`;
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
    const quarantinePath = `${this.filePath}.corrupt-${this.now()}`;
    try {
      await rename(this.filePath, quarantinePath);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
}

function normalizePage(page: BrowserSerializedPage, now: number): BrowserSerializedPage {
  const entries = page.navigation.entries.slice(-MAX_NAVIGATION_ENTRIES);
  const droppedCount = page.navigation.entries.length - entries.length;
  const currentIndex = Math.max(
    0,
    Math.min(entries.length - 1, page.navigation.currentIndex - droppedCount),
  );
  return BrowserSerializedPageSchema.parse({
    ...page,
    updatedAt: Number.isFinite(page.updatedAt) ? page.updatedAt : now,
    navigation: {
      currentIndex,
      entries,
    },
  });
}

function encodedStoreBytes(pages: ReadonlyMap<string, BrowserSerializedPage>): number {
  return Buffer.byteLength(
    JSON.stringify({
      schemaVersion: 1,
      pages: Object.fromEntries(pages),
    }),
  );
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
