import path from "node:path";
import {
  MAX_MANAGED_IMAGE_BYTES,
} from "../../shared/managed-assets";
import { isSupportedImageMimeType } from "../local-store/assets";

const ALLOWED_BROWSER_IMAGE_PROTOCOLS = new Set([
  "blob:",
  "data:",
  "http:",
  "https:",
]);

interface FetchBrowserImageInput {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  pageUrl: string;
  sourceUrl: string;
}

export interface FetchedBrowserImage {
  bytes: Uint8Array;
  mimeType: string;
  name: string;
}

function parseAllowedImageUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (
    !ALLOWED_BROWSER_IMAGE_PROTOCOLS.has(url.protocol)
    || url.username.length > 0
    || url.password.length > 0
  ) {
    throw new Error("This image URL is not allowed");
  }
  return url;
}

function imageName(url: URL, mimeType: string): string {
  const candidate = decodeURIComponent(
    url.pathname.split("/").filter(Boolean).at(-1) ?? "",
  ).replace(/[\u0000-\u001F\u007F/\\]/gu, "").slice(0, 512);
  if (candidate) return candidate;
  const extension = mimeType === "image/jpeg"
    ? ".jpg"
    : mimeType === "image/png"
      ? ".png"
      : mimeType === "image/gif"
        ? ".gif"
        : mimeType === "image/webp"
          ? ".webp"
          : "";
  return `browser-image${extension}`;
}

async function readBoundedResponseBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MANAGED_IMAGE_BYTES) {
    throw new Error("Image exceeds 10MB attachment limit");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_MANAGED_IMAGE_BYTES) {
      throw new Error("Image exceeds 10MB attachment limit");
    }
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    totalBytes += result.value.byteLength;
    if (totalBytes > MAX_MANAGED_IMAGE_BYTES) {
      await reader.cancel("Image exceeds attachment limit");
      throw new Error("Image exceeds 10MB attachment limit");
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchBrowserImage({
  fetch,
  pageUrl,
  sourceUrl,
}: FetchBrowserImageInput): Promise<FetchedBrowserImage> {
  const url = parseAllowedImageUrl(sourceUrl);
  const page = new URL(pageUrl);
  const referrer = ["http:", "https:"].includes(page.protocol)
    && page.username.length === 0
    && page.password.length === 0
    ? page.href
    : undefined;
  const response = await fetch(url.href, {
    ...(referrer ? { referrer } : {}),
  });
  if (!response.ok) {
    throw new Error(`Image request failed with status ${response.status}`);
  }

  const mimeType = response.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() ?? "";
  if (!isSupportedImageMimeType(mimeType)) {
    throw new Error("The selected resource is not a supported image");
  }
  const bytes = await readBoundedResponseBody(response);
  if (bytes.byteLength === 0) throw new Error("The selected image is empty");

  return {
    bytes,
    mimeType,
    name: path.basename(imageName(url, mimeType)),
  };
}
