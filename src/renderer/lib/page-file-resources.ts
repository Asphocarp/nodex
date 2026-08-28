import type { ContentAccessContext } from "../../shared/content-access-context";
import type { LibraryPageFileManifest, LibraryPageFileSummary } from "../../shared/library-module";
import {
  PAGE_FILE_IMPORT_MAX_BYTES,
  PAGE_FILE_IMPORT_MAX_COUNT,
  PAGE_FILE_MAX_BYTES,
  pageFileSource,
  parsePageFileSource,
  type PageFileBytes,
  type PreparedPickedPageFile,
} from "../../shared/page-files";
import { createUuidV7 } from "../../shared/uuid-v7";
import {
  applyLibraryModule,
  preparePageFile,
  readLibraryModule,
  readPageFileBytes,
  savePageFile,
} from "./api";

const PAGE_FILE_READ_LIMIT = 100;
const MAX_PAGE_FILE_COUNT = 10_000;

export interface PageFileAuthority {
  readonly contentAccessContext: ContentAccessContext;
  readonly pageId: string;
  readonly storeEpoch: string;
}

export type PageFileUploadSource =
  | { readonly kind: "browser_file"; readonly file: File }
  | { readonly kind: "local_path"; readonly path: string };

export interface CreatedPageFile {
  readonly fileId: string;
  readonly logicalPath: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly source: string;
}

const splitFileName = (logicalPath: string): readonly [string, string] => {
  const slash = logicalPath.lastIndexOf("/");
  const directory = slash < 0 ? "" : logicalPath.slice(0, slash + 1);
  const name = slash < 0 ? logicalPath : logicalPath.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [`${directory}${name}`, ""];
  return [`${directory}${name.slice(0, dot)}`, name.slice(dot)];
};

export const portablePageFilePathKey = (path: string): string =>
  path.normalize("NFKC").toLocaleLowerCase("en");

export const allocatePageFilePath = (
  preferredPath: string,
  occupiedPaths: ReadonlySet<string>,
): string => {
  if (!occupiedPaths.has(portablePageFilePathKey(preferredPath))) return preferredPath;
  const [stem, extension] = splitFileName(preferredPath);
  for (let index = 2; index < MAX_PAGE_FILE_COUNT; index += 1) {
    const candidate = `${stem} (${index})${extension}`;
    if (!occupiedPaths.has(portablePageFilePathKey(candidate))) return candidate;
  }
  return `${stem}-${createUuidV7()}${extension}`;
};

/** Validate a browser-delivered selection before publishing any immutable blobs. */
export function validateBrowserPageFileBatch(files: readonly File[]): void {
  if (files.length > PAGE_FILE_IMPORT_MAX_COUNT) {
    throw new Error("File selection exceeds the 100 File batch limit");
  }

  let totalBytes = 0;
  for (const file of files) {
    if (file.size > PAGE_FILE_MAX_BYTES) {
      throw new Error(`${file.name} exceeds the 64 MiB File limit`);
    }
    totalBytes += file.size;
  }

  if (totalBytes > PAGE_FILE_IMPORT_MAX_BYTES) {
    throw new Error("File selection exceeds the 256 MiB batch limit");
  }
}

/** Prepare browser File objects sequentially so a large batch has bounded renderer memory use. */
export async function prepareBrowserPageFiles(
  contentAccessContext: ContentAccessContext,
  operationId: string,
  files: readonly File[],
): Promise<readonly PreparedPickedPageFile[]> {
  validateBrowserPageFileBatch(files);
  const prepared: PreparedPickedPageFile[] = [];
  for (const file of files) {
    prepared.push(
      await preparePageFile(contentAccessContext, {
        operationId,
        source: {
          kind: "bytes",
          logicalPath: file.name,
          ...(file.type ? { mimeType: file.type } : {}),
          bytes: new Uint8Array(await file.arrayBuffer()),
        },
      }),
    );
  }
  return prepared;
}

const pageFilesFromRead = (value: Awaited<ReturnType<typeof readLibraryModule>>) => {
  if (!value.ok) throw new Error(value.error.message || "Couldn’t read Page Files");
  if (value.value.value.kind !== "page_files") {
    throw new Error("Unexpected Page Files response");
  }
  return value.value.value.value;
};

/** Read one manifest revision completely so path allocation never depends on a partial UI page. */
export async function readCompletePageFileManifest(
  contentAccessContext: ContentAccessContext,
  pageId: string,
  includeDeleted = false,
): Promise<LibraryPageFileManifest> {
  let cursor: string | undefined;
  let expectedRevision: number | null = null;
  let expectedBodyUsageRevision: LibraryPageFileManifest["bodyUsageRevision"] | null = null;
  let total = 0;
  const files: LibraryPageFileSummary[] = [];

  do {
    const page = pageFilesFromRead(
      await readLibraryModule(contentAccessContext, {
        read: {
          mode: "page_files",
          pageId,
          limit: PAGE_FILE_READ_LIMIT,
          includeDeleted,
          ...(cursor ? { cursor } : {}),
        },
      }),
    );
    if (expectedRevision !== null && page.revision !== expectedRevision) {
      throw new Error("Page Files changed while they were being read");
    }
    if (
      expectedBodyUsageRevision !== null &&
      page.bodyUsageRevision !== expectedBodyUsageRevision
    ) {
      throw new Error("Page File body usage changed while Files were being read");
    }
    expectedRevision = page.revision;
    expectedBodyUsageRevision = page.bodyUsageRevision;
    total = page.total;
    files.push(...page.files);
    if (files.length > MAX_PAGE_FILE_COUNT) {
      throw new Error("Page has too many Files to read safely");
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return {
    pageId,
    revision: expectedRevision ?? 0,
    bodyUsageRevision: expectedBodyUsageRevision ?? 0,
    files,
    nextCursor: null,
    hasMore: false,
    total,
  };
}

/** Prepare immutable bytes, claim one Page path, and expose the resulting stable File URI. */
export async function createOwnedPageFile(
  authority: PageFileAuthority,
  source: PageFileUploadSource,
  preferredLogicalPath?: string,
): Promise<CreatedPageFile> {
  const operationId = createUuidV7();
  const prepared =
    source.kind === "browser_file"
      ? (
          await prepareBrowserPageFiles(authority.contentAccessContext, operationId, [source.file])
        )[0]!
      : await preparePageFile(authority.contentAccessContext, {
          operationId,
          source: { kind: "local_path", path: source.path },
        });
  const manifest = await readCompletePageFileManifest(
    authority.contentAccessContext,
    authority.pageId,
  );
  const occupiedPaths = new Set(
    manifest.files.map((file) => portablePageFilePathKey(file.logicalPath)),
  );
  const logicalPath = allocatePageFilePath(
    preferredLogicalPath?.trim() || prepared.logicalPath,
    occupiedPaths,
  );
  const fileId = createUuidV7();
  const result = await applyLibraryModule(authority.contentAccessContext, {
    operationId,
    storeEpoch: authority.storeEpoch,
    operation: {
      kind: "apply_page_file_changes",
      pageId: authority.pageId,
      expectedManifestRevision: manifest.revision,
      changes: [
        {
          kind: "create",
          fileId,
          logicalPath,
          mimeType: prepared.mimeType,
          preparedBlobReceiptId: prepared.receiptId,
        },
      ],
    },
  });
  if (!result.ok) throw new Error(result.error.message || "Couldn’t add Page File");
  return {
    fileId,
    logicalPath,
    mimeType: prepared.mimeType,
    byteLength: prepared.byteLength,
    source: pageFileSource(fileId),
  };
}

export async function readOwnedPageFile(
  authority: Pick<PageFileAuthority, "contentAccessContext" | "pageId">,
  source: string,
): Promise<PageFileBytes> {
  const fileId = parsePageFileSource(source);
  if (!fileId) throw new Error("Page File reference is invalid");
  return readPageFileBytes(authority.contentAccessContext, {
    pageId: authority.pageId,
    fileId,
  });
}

export async function readOwnedPageFileMetadata(
  authority: Pick<PageFileAuthority, "contentAccessContext" | "pageId">,
  source: string,
): Promise<LibraryPageFileSummary> {
  const fileId = parsePageFileSource(source);
  if (!fileId) throw new Error("Page File reference is invalid");
  const result = await readLibraryModule(authority.contentAccessContext, {
    read: { mode: "page_file_metadata", pageId: authority.pageId, fileId },
  });
  if (!result.ok) throw new Error(result.error.message || "Couldn’t read Page File metadata");
  if (result.value.value.kind !== "page_file_metadata") {
    throw new Error("Unexpected Page File metadata response");
  }
  return result.value.value.value;
}

export async function saveOwnedPageFile(
  authority: Pick<PageFileAuthority, "contentAccessContext" | "pageId">,
  source: string,
  logicalPath: string,
): Promise<void> {
  const fileId = parsePageFileSource(source);
  if (!fileId) throw new Error("Page File reference is invalid");
  await savePageFile(authority.contentAccessContext, {
    pageId: authority.pageId,
    fileId,
    logicalPath,
  });
}

export async function pageFileImageDataUrl(
  authority: Pick<PageFileAuthority, "contentAccessContext" | "pageId">,
  source: string,
): Promise<string> {
  const file = await readOwnedPageFile(authority, source);
  const blob = new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: file.mimeType });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "error",
      () => reject(reader.error ?? new Error("Couldn’t read Page File image")),
      { once: true },
    );
    reader.addEventListener(
      "load",
      () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("Couldn’t encode Page File image")),
      { once: true },
    );
    reader.readAsDataURL(blob);
  });
}
