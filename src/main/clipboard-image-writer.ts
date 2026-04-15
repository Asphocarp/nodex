import { createRequire } from "node:module";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClipboardWriteImageResult } from "../shared/ipc-api";
import { parseAssetSource } from "../shared/assets";
import { resolveAssetPath } from "./kanban/asset-service";

const require = createRequire(import.meta.url);

interface NativeImageLike {
  isEmpty(): boolean;
}

interface ClipboardTarget {
  writeImage: (image: NativeImageLike) => void;
}

interface NativeImageApi {
  createFromBuffer: (buffer: Buffer) => NativeImageLike;
  createFromDataURL: (dataUrl: string) => NativeImageLike;
}

interface ClipboardImageWriterDeps {
  clipboardTarget?: ClipboardTarget;
  fetchImpl?: typeof fetch;
  nativeImageApi?: NativeImageApi;
  readFile?: (filePath: string) => Promise<Buffer>;
  resolveAssetPath?: (fileName: string) => string;
}

function fail(message: string): ClipboardWriteImageResult {
  return { ok: false, message };
}

function isHttpLikeUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isDataImageUrl(value: string): boolean {
  return value.startsWith("data:image/");
}

function resolveLocalImagePath(
  source: string,
  assetPathResolver: (fileName: string) => string,
): string | null {
  const assetSource = parseAssetSource(source);
  if (assetSource) {
    return assetPathResolver(assetSource.fileName);
  }

  if (source.startsWith("file://")) {
    try {
      return fileURLToPath(source);
    } catch {
      throw new Error("Could not load the image file.");
    }
  }

  if (path.isAbsolute(source)) {
    return path.resolve(source);
  }

  return null;
}

async function createNativeImageFromSource(
  source: string,
  deps: Required<ClipboardImageWriterDeps>,
): Promise<NativeImageLike | null> {
  if (isDataImageUrl(source)) {
    return deps.nativeImageApi.createFromDataURL(source);
  }

  if (isHttpLikeUrl(source)) {
    let response: Response;
    try {
      response = await deps.fetchImpl(source);
    } catch {
      throw new Error("Could not load the image file.");
    }
    if (!response.ok) {
      throw new Error("Could not load the image file.");
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    return deps.nativeImageApi.createFromBuffer(bytes);
  }

  const localPath = resolveLocalImagePath(source, deps.resolveAssetPath);
  if (!localPath) {
    return null;
  }

  let bytes: Buffer;
  try {
    bytes = await deps.readFile(localPath);
  } catch {
    throw new Error("Could not load the image file.");
  }
  return deps.nativeImageApi.createFromBuffer(bytes);
}

function resolveClipboardImageWriterDeps(
  deps: ClipboardImageWriterDeps = {},
): Required<ClipboardImageWriterDeps> {
  const electron = require("electron") as typeof import("electron");

  return {
    clipboardTarget: deps.clipboardTarget ?? (electron.clipboard as unknown as ClipboardTarget),
    fetchImpl: deps.fetchImpl ?? fetch,
    nativeImageApi: deps.nativeImageApi ?? electron.nativeImage,
    readFile: deps.readFile ?? fs.readFile,
    resolveAssetPath: deps.resolveAssetPath ?? resolveAssetPath,
  };
}

export async function writeImageToClipboard(
  source: string,
  deps: ClipboardImageWriterDeps = {},
): Promise<ClipboardWriteImageResult> {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    return fail("Could not copy image.");
  }

  const resolvedDeps = resolveClipboardImageWriterDeps(deps);

  try {
    const image = await createNativeImageFromSource(normalizedSource, resolvedDeps);
    if (!image) {
      return fail("Could not copy image.");
    }
    if (image.isEmpty()) {
      return fail("Could not decode this image format for clipboard copy.");
    }

    resolvedDeps.clipboardTarget.writeImage(image);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message.length > 0) {
      return fail(error.message);
    }
    return fail("Could not copy image.");
  }
}
