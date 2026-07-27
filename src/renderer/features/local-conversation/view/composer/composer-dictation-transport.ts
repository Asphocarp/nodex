import { invoke } from "@/lib/api";

const DEFAULT_DICTATION_CONTENT_TYPE = "audio/webm";
const BASE64_CHUNK_SIZE = 32_768;

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let totalSize = 0;
  for (const chunk of chunks) {
    totalSize += chunk.byteLength;
  }

  const bytes = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function sanitizeDictationFilename(value: string): string {
  return value.replace(/"/g, "");
}

export function createDictationBoundary(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `----codex-transcribe-${crypto.randomUUID()}`;
  }

  return `----codex-transcribe-${Math.random().toString(36).slice(2)}`;
}

export function encodeDictationBase64(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.byteLength; index += BASE64_CHUNK_SIZE) {
    text += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK_SIZE));
  }
  return btoa(text);
}

export async function buildDictationMultipartPayload(input: {
  blob: Blob;
  boundary: string;
  filename: string;
  contentType: string;
  language?: string;
}): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const bytes = new Uint8Array(await input.blob.arrayBuffer());

  chunks.push(encoder.encode(`--${input.boundary}\r\n`));
  chunks.push(
    encoder.encode(
      `Content-Disposition: form-data; name="file"; filename="${input.filename}"\r\n`,
    ),
  );
  chunks.push(encoder.encode(`Content-Type: ${input.contentType}\r\n\r\n`));
  chunks.push(bytes);
  chunks.push(encoder.encode("\r\n"));

  if (input.language) {
    chunks.push(encoder.encode(`--${input.boundary}\r\n`));
    chunks.push(
      encoder.encode(`Content-Disposition: form-data; name="language"\r\n\r\n`),
    );
    chunks.push(encoder.encode(`${input.language}\r\n`));
  }

  chunks.push(encoder.encode(`--${input.boundary}--\r\n`));
  return concatBytes(chunks);
}

function resolveDictationContentType(blob: Blob, override?: string): string {
  const contentType = override ?? blob.type;
  if (contentType.trim().length > 0) {
    return contentType;
  }

  return DEFAULT_DICTATION_CONTENT_TYPE;
}

function resolveDictationFilename(contentType: string, override?: string): string {
  const extension = contentType.split(/[/;]/)[1] ?? "webm";
  return sanitizeDictationFilename(override ?? `codex.${extension}`);
}

export async function transcribeDictationBlob(
  blob: Blob,
  options?: {
    contentType?: string;
    filename?: string;
    language?: string;
    transcribe?: (input: {
      contentType: string;
      base64Payload: string;
    }) => Promise<string>;
  },
): Promise<string> {
  const contentType = resolveDictationContentType(blob, options?.contentType);
  const filename = resolveDictationFilename(contentType, options?.filename);
  const boundary = createDictationBoundary();
  const multipartBody = await buildDictationMultipartPayload({
    blob,
    boundary,
    filename,
    contentType,
    language: options?.language,
  });
  const transcribe = options?.transcribe
    ?? (async (input) => await invoke("codex:dictation:transcribe", input));
  return await transcribe({
    contentType: `multipart/form-data; boundary=${boundary}`,
    base64Payload: encodeDictationBase64(multipartBody),
  });
}
