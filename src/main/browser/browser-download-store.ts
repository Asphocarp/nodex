import { z } from "zod";
import type { BrowserDownloadRecord } from "../../shared/browser-download";

export const MAX_BROWSER_DOWNLOAD_RECORDS = 1_000;
export const MAX_BROWSER_DOWNLOAD_STORE_BYTES = 16 * 1024 * 1024;

const BrowserDownloadRecordSchema = z
  .object({
    id: z.string().min(1).max(512),
    browserConversationId: z.string().min(1).max(512),
    browserViewScopeId: z.string().min(1).max(512),
    browserTabId: z.string().min(1).max(512),
    fileName: z.string().min(1).max(2_048),
    savePath: z.string().min(1).max(16_384),
    sourceOrigin: z.string().min(1).max(16_384),
    status: z.enum(["starting", "progressing", "paused", "completed", "cancelled", "interrupted"]),
    receivedBytes: z.number().finite().nonnegative(),
    totalBytes: z.number().finite().nonnegative(),
    startedAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
    completedAt: z.number().finite().nonnegative().optional(),
    interruptReason: z.string().max(2_048).optional(),
  })
  .strict();

const BrowserDownloadStoreFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    downloads: z.array(BrowserDownloadRecordSchema).max(MAX_BROWSER_DOWNLOAD_RECORDS),
  })
  .strict();

export const parseBrowserDownloadHistory = (raw: string): readonly BrowserDownloadRecord[] =>
  BrowserDownloadStoreFileSchema.parse(JSON.parse(raw)).downloads;

export const normalizeBrowserDownloadHistory = (
  records: Iterable<BrowserDownloadRecord>,
): ReadonlyMap<string, BrowserDownloadRecord> => {
  const byId = new Map<string, BrowserDownloadRecord>();
  for (const value of records) {
    const record = BrowserDownloadRecordSchema.parse(value);
    byId.set(record.id, record);
  }
  const newest = [...byId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_BROWSER_DOWNLOAD_RECORDS);
  const normalized = new Map(newest.map((record) => [record.id, record] as const));
  while (
    normalized.size > 0 &&
    Buffer.byteLength(JSON.stringify([...normalized.values()])) > MAX_BROWSER_DOWNLOAD_STORE_BYTES
  ) {
    const oldest = [...normalized.values()].sort(
      (left, right) => left.updatedAt - right.updatedAt,
    )[0];
    if (oldest === undefined) break;
    normalized.delete(oldest.id);
  }
  return normalized;
};

export const serializeBrowserDownloadHistory = (
  records: ReadonlyMap<string, BrowserDownloadRecord>,
): string =>
  `${JSON.stringify(
    {
      schemaVersion: 1,
      downloads: [...normalizeBrowserDownloadHistory(records.values()).values()],
    },
    null,
    2,
  )}\n`;
