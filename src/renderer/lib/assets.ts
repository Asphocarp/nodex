import {
  MAX_MANAGED_IMAGE_BYTES,
  MAX_MANAGED_RESOURCE_BYTES,
  getManagedAssetDisplayUrl,
  type ManagedCanvasImageMaterializationResult,
  type ManagedAssetPreview,
  type ManagedAssetPreviewInput,
  type ManagedResourceSaveResult,
} from "../../shared/managed-assets";
import { invoke } from "./api";

export interface UploadedResourceAssetResponse {
  source: string;
  name: string;
  mimeType: string;
  bytes: number;
}

export function resolveAssetSourceToDisplayUrl(source: string): string {
  return getManagedAssetDisplayUrl(source);
}

function fileToUploadInput(file: File, bytes: Uint8Array) {
  return {
    name: file.name,
    mimeType: file.type,
    bytes,
  };
}

export async function uploadImageAsset(file: File): Promise<string> {
  if (file.size > MAX_MANAGED_IMAGE_BYTES) {
    throw new Error("Image exceeds 10MB upload limit");
  }
  const result = await invoke(
    "asset:image:save",
    fileToUploadInput(file, new Uint8Array(await file.arrayBuffer())),
  );
  return result.source;
}

export async function materializeCanvasImageAsset(
  file: File,
): Promise<ManagedCanvasImageMaterializationResult> {
  if (file.size > MAX_MANAGED_IMAGE_BYTES) {
    throw new Error("Image exceeds 10MB upload limit");
  }
  return await invoke(
    "asset:canvas-image:materialize",
    fileToUploadInput(file, new Uint8Array(await file.arrayBuffer())),
  );
}

function toUploadedResourceAssetResponse(
  result: ManagedResourceSaveResult,
): UploadedResourceAssetResponse {
  return {
    source: result.source,
    name: result.name,
    mimeType: result.mimeType,
    bytes: result.bytes,
  };
}

export async function uploadResourceAsset(
  file: File,
): Promise<UploadedResourceAssetResponse> {
  if (file.size > MAX_MANAGED_RESOURCE_BYTES) {
    throw new Error("Resource exceeds 64MB upload limit");
  }
  return toUploadedResourceAssetResponse(await invoke(
    "asset:resource:save",
    fileToUploadInput(file, new Uint8Array(await file.arrayBuffer())),
  ));
}

export async function materializeLocalResourceAsset(
  localPath: string,
): Promise<UploadedResourceAssetResponse> {
  return toUploadedResourceAssetResponse(
    await invoke("asset:resource:materialize", localPath),
  );
}

export async function readManagedAssetPreview(
  input: ManagedAssetPreviewInput,
): Promise<ManagedAssetPreview> {
  return await invoke("asset:preview:read", input);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
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
}

export async function readManagedImageDataUrl(source: string): Promise<string> {
  const result = await invoke("asset:image:read", source);
  return await readBlobAsDataUrl(
    new Blob([new Uint8Array(result.bytes)], { type: result.mimeType }),
  );
}

export async function readManagedImageByteLength(source: string): Promise<number> {
  const result = await invoke("asset:image:read", source);
  return result.bytes.byteLength;
}
