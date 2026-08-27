export interface PickPageFilesInput {
  readonly operationId: string;
  readonly title?: string;
  readonly selection?: "files" | "directory";
}

export const PAGE_FILE_MAX_BYTES = 64 * 1024 * 1024;
export const PAGE_FILE_IMPORT_MAX_BYTES = 256 * 1024 * 1024;
export const PAGE_FILE_IMPORT_MAX_COUNT = 100;

export interface PreparePageFileInput {
  readonly operationId: string;
  readonly source:
    | {
        readonly kind: "bytes";
        readonly logicalPath: string;
        readonly mimeType?: string;
        readonly bytes: Uint8Array;
      }
    | {
        readonly kind: "local_path";
        readonly path: string;
      };
}

export interface PrepareDroppedPageFilesInput {
  readonly operationId: string;
  readonly localPaths: readonly string[];
}

export interface PreparedPickedPageFile {
  readonly logicalPath: string;
  readonly mimeType: string;
  readonly receiptId: string;
  readonly blobEtag: string;
  readonly byteLength: number;
  readonly expiresAtUnixMs: number;
}

export const PAGE_FILE_SOURCE_PREFIX = "nodex://files/";

export const pageFileSource = (fileId: string): string => {
  if (
    !fileId ||
    fileId !== fileId.trim() ||
    fileId.includes("/") ||
    fileId.includes("%") ||
    /[\u0000-\u001f\u007f]/u.test(fileId)
  ) {
    throw new Error("Page File IDs must be non-empty URI path segments");
  }
  return `${PAGE_FILE_SOURCE_PREFIX}${fileId}`;
};

export const parsePageFileSource = (source: string): string | null => {
  if (!source.startsWith(PAGE_FILE_SOURCE_PREFIX)) return null;
  const fileId = source.slice(PAGE_FILE_SOURCE_PREFIX.length);
  if (
    !fileId ||
    fileId !== fileId.trim() ||
    fileId.includes("/") ||
    fileId.includes("%") ||
    /[\u0000-\u001f\u007f]/u.test(fileId)
  ) {
    return null;
  }
  return fileId;
};

export interface PickPageFilesResult {
  readonly cancelled: boolean;
  readonly files: readonly PreparedPickedPageFile[];
}

export interface PrepareDroppedPageFilesResult {
  readonly files: readonly PreparedPickedPageFile[];
}

export interface ReadPageFileBytesInput {
  readonly pageId: string;
  readonly fileId: string;
  readonly version?: number;
}

export interface PageFileBytes {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly etag: string;
}

export interface SavePageFileInput extends ReadPageFileBytesInput {
  readonly logicalPath: string;
}

export interface SavePageFileResult {
  readonly status: "cancelled" | "saved";
}
