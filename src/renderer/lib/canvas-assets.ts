import type { CanvasFileSnapshot } from "../../shared/block-documents";
import { resolveAssetSourceToHttpUrl, uploadImageAsset } from "./assets";

export interface CanvasBinaryFileData {
  readonly id: string;
  readonly dataURL: string;
  readonly mimeType: string;
  readonly created: number;
  readonly lastRetrieved?: number;
}

export type CanvasBinaryFiles = Readonly<Record<string, CanvasBinaryFileData>>;

export interface CanvasAssetBridgeDependencies {
  readonly uploadImage?: (file: File) => Promise<string>;
  readonly fetchAsset?: (url: string) => Promise<Response>;
  readonly blobToDataUrl?: (blob: Blob) => Promise<string>;
  readonly now?: () => number;
}

export const collectCanvasReferencedFileIds = (
  elements: readonly unknown[],
): ReadonlySet<string> => {
  const fileIds = new Set<string>();
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const candidate = element as Readonly<Record<string, unknown>>;
    if (
      candidate.type === "image" &&
      candidate.isDeleted !== true &&
      typeof candidate.fileId === "string"
    ) {
      fileIds.add(candidate.fileId);
    }
  }
  return fileIds;
};

const extensionForMimeType = (mimeType: string): string => {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/avif") return ".avif";
  return ".png";
};

const dataUrlToFile = async (file: CanvasBinaryFileData): Promise<File> => {
  const response = await fetch(file.dataURL);
  if (!response.ok) throw new Error(`Canvas file ${file.id} is unreadable`);
  const blob = await response.blob();
  return new File(
    [blob],
    `${file.id}${extensionForMimeType(file.mimeType)}`,
    { type: file.mimeType },
  );
};

/** Upload-first conversion; no scene mutation is enqueued until every file exists. */
export const materializeDurableCanvasFiles = async (input: {
  readonly elementsIncludingDeleted: readonly unknown[];
  readonly binaryFiles: CanvasBinaryFiles;
  readonly current: Readonly<Record<string, CanvasFileSnapshot>>;
  readonly dependencies?: CanvasAssetBridgeDependencies;
}): Promise<Readonly<Record<string, CanvasFileSnapshot>>> => {
  const upload = input.dependencies?.uploadImage ?? uploadImageAsset;
  const durable: Record<string, CanvasFileSnapshot> = {};
  for (const fileId of collectCanvasReferencedFileIds(
    input.elementsIncludingDeleted,
  )) {
    const current = input.current[fileId];
    if (current) {
      durable[fileId] = current;
      continue;
    }
    const binary = input.binaryFiles[fileId];
    if (!binary) {
      throw new Error(`Canvas image ${fileId} has no binary payload`);
    }
    const file = await dataUrlToFile(binary);
    const source = await upload(file);
    durable[fileId] = {
      id: fileId,
      mimeType: binary.mimeType,
      source,
      created: binary.created,
    };
  }
  return durable;
};

const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Asset read failed"));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Asset reader returned a non-string result"));
    };
    reader.readAsDataURL(blob);
  });

interface CanvasBinaryFileCacheEntry {
  readonly identity: string;
  readonly dataUrl: Promise<string>;
}

const canvasFileContentIdentity = (file: CanvasFileSnapshot): string =>
  `${file.source}\0${file.mimeType}`;

/**
 * Surface-scoped resolver for remote scene presentation. Cache identity is the
 * immutable managed source plus MIME type; each resolve prunes files no longer
 * referenced and shares in-flight reads for unchanged entries.
 */
export class CanvasBinaryFileResolver {
  private readonly dependencies: CanvasAssetBridgeDependencies;
  private readonly cache = new Map<string, CanvasBinaryFileCacheEntry>();
  private destroyed = false;

  constructor(dependencies: CanvasAssetBridgeDependencies = {}) {
    this.dependencies = dependencies;
  }

  resolve = async (
    files: Readonly<Record<string, CanvasFileSnapshot>>,
  ): Promise<CanvasBinaryFiles> => {
    if (this.destroyed) {
      throw new Error("Canvas binary file resolver is destroyed");
    }
    const referencedIds = new Set(Object.keys(files));
    for (const fileId of this.cache.keys()) {
      if (!referencedIds.has(fileId)) this.cache.delete(fileId);
    }
    const resolved = await Promise.all(
      Object.entries(files)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(async ([fileId, file]) => {
          const identity = canvasFileContentIdentity(file);
          const entry = this.getOrCreateEntry(fileId, file, identity);
          const dataURL = await entry.dataUrl;
          const now = (this.dependencies.now ?? Date.now)();
          return [
            fileId,
            {
              id: fileId,
              dataURL,
              mimeType: file.mimeType,
              created: file.created ?? now,
              lastRetrieved: now,
            },
          ] as const;
        }),
    );
    return Object.fromEntries(resolved);
  };

  clear = (): void => {
    this.cache.clear();
  };

  destroy = (): void => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clear();
  };

  private getOrCreateEntry(
    fileId: string,
    file: CanvasFileSnapshot,
    identity: string,
  ): CanvasBinaryFileCacheEntry {
    const current = this.cache.get(fileId);
    if (current?.identity === identity) return current;
    const fetchAsset = this.dependencies.fetchAsset ?? fetch;
    const blobToDataUrl = this.dependencies.blobToDataUrl ?? readBlobAsDataUrl;
    const entry: CanvasBinaryFileCacheEntry = {
      identity,
      dataUrl: fetchAsset(resolveAssetSourceToHttpUrl(file.source))
        .then((response) => {
          if (response.ok) return response.blob();
          throw new Error(`Managed Canvas asset ${file.source} is unavailable`);
        })
        .then(blobToDataUrl),
    };
    this.cache.set(fileId, entry);
    void entry.dataUrl.catch(() => {
      if (this.cache.get(fileId) === entry) this.cache.delete(fileId);
    });
    return entry;
  }
}

/** Resolve ref-only durable files into Excalidraw's disposable BinaryFiles. */
export const resolveCanvasBinaryFiles = async (
  files: Readonly<Record<string, CanvasFileSnapshot>>,
  dependencies: CanvasAssetBridgeDependencies = {},
): Promise<CanvasBinaryFiles> => {
  const resolver = new CanvasBinaryFileResolver(dependencies);
  try {
    return await resolver.resolve(files);
  } finally {
    resolver.destroy();
  }
};
