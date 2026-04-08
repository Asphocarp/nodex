import { resolveHttpBase } from "@/lib/http-base";

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

function parseDictationResponse(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { text?: unknown; body?: { text?: unknown } };
    if (typeof parsed.text === "string") {
      return parsed.text;
    }
    if (typeof parsed.body?.text === "string") {
      return parsed.body.text;
    }
  } catch {
    if (bodyText.trim().length > 0) {
      return bodyText;
    }
  }

  return "";
}

export async function transcribeDictationBlob(
  blob: Blob,
  options?: {
    contentType?: string;
    filename?: string;
    language?: string;
    fetchImpl?: typeof fetch;
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
  const fetchImpl = options?.fetchImpl ?? fetch;
  const response = await fetchImpl(`${resolveHttpBase()}/transcribe`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "X-Codex-Base64": "1",
    },
    body: encodeDictationBase64(multipartBody),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(parseDictationResponse(bodyText) || "Unable to transcribe audio");
  }

  return parseDictationResponse(bodyText);
}
