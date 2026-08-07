const DOCUMENT_HTTP_MAGIC = new Uint8Array([0x4e, 0x44, 0x58, 0x03]);
const DOCUMENT_HTTP_HEADER_BYTES = DOCUMENT_HTTP_MAGIC.byteLength + 4;
export const MAX_DOCUMENT_HTTP_METADATA_BYTES = 8 * 1024 * 1024;

export interface DocumentHttpEnvelope<TMetadata> {
  readonly metadata: TMetadata;
  readonly payload: Uint8Array;
}

export class DocumentHttpWireError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentHttpWireError";
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertMetadataLength = (length: number): void => {
  if (length <= MAX_DOCUMENT_HTTP_METADATA_BYTES) return;
  throw new DocumentHttpWireError(
    `Document HTTP metadata exceeds ${MAX_DOCUMENT_HTTP_METADATA_BYTES} bytes`,
  );
};

export const encodeDocumentHttpEnvelope = <TMetadata extends object>(
  metadata: TMetadata,
  payload: Uint8Array,
): Uint8Array => {
  let metadataBytes: Uint8Array;
  try {
    metadataBytes = textEncoder.encode(JSON.stringify(metadata));
  } catch (error) {
    throw new DocumentHttpWireError("Document HTTP metadata is not serializable", {
      cause: error,
    });
  }
  assertMetadataLength(metadataBytes.byteLength);

  const envelope = new Uint8Array(
    DOCUMENT_HTTP_HEADER_BYTES + metadataBytes.byteLength + payload.byteLength,
  );
  envelope.set(DOCUMENT_HTTP_MAGIC, 0);
  new DataView(envelope.buffer).setUint32(
    DOCUMENT_HTTP_MAGIC.byteLength,
    metadataBytes.byteLength,
    false,
  );
  envelope.set(metadataBytes, DOCUMENT_HTTP_HEADER_BYTES);
  envelope.set(payload, DOCUMENT_HTTP_HEADER_BYTES + metadataBytes.byteLength);
  return envelope;
};

export const decodeDocumentHttpEnvelope = <TMetadata extends object>(
  bytes: Uint8Array,
  validateMetadata: (value: unknown) => TMetadata,
  maxPayloadBytes: number,
): DocumentHttpEnvelope<TMetadata> => {
  if (bytes.byteLength < DOCUMENT_HTTP_HEADER_BYTES) {
    throw new DocumentHttpWireError("Document HTTP envelope is truncated");
  }
  const hasMagic = DOCUMENT_HTTP_MAGIC.every(
    (value, index) => bytes[index] === value,
  );
  if (!hasMagic) {
    throw new DocumentHttpWireError("Document HTTP envelope has an invalid version");
  }

  const metadataLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(DOCUMENT_HTTP_MAGIC.byteLength, false);
  assertMetadataLength(metadataLength);
  const payloadOffset = DOCUMENT_HTTP_HEADER_BYTES + metadataLength;
  if (payloadOffset > bytes.byteLength) {
    throw new DocumentHttpWireError("Document HTTP metadata is truncated");
  }
  const payloadLength = bytes.byteLength - payloadOffset;
  if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes < 0) {
    throw new DocumentHttpWireError("Document HTTP payload limit is invalid");
  }
  if (payloadLength > maxPayloadBytes) {
    throw new DocumentHttpWireError(
      `Document HTTP payload exceeds ${maxPayloadBytes} bytes`,
    );
  }

  let rawMetadata: unknown;
  try {
    const metadataJson = textDecoder.decode(
      bytes.subarray(DOCUMENT_HTTP_HEADER_BYTES, payloadOffset),
    );
    rawMetadata = JSON.parse(metadataJson);
  } catch (error) {
    throw new DocumentHttpWireError("Document HTTP metadata is invalid JSON", {
      cause: error,
    });
  }
  if (!isRecord(rawMetadata)) {
    throw new DocumentHttpWireError("Document HTTP metadata must be an object");
  }

  let metadata: TMetadata;
  try {
    metadata = validateMetadata(rawMetadata);
  } catch (error) {
    if (error instanceof DocumentHttpWireError) throw error;
    throw new DocumentHttpWireError("Document HTTP metadata failed validation", {
      cause: error,
    });
  }
  return {
    metadata,
    payload: bytes.subarray(payloadOffset).slice(),
  };
};

export const documentBytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

export const documentBytesFromBase64 = (
  encoded: string,
  maxBytes: number,
): Uint8Array => {
  const isCanonicalBase64 =
    encoded.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    );
  if (!isCanonicalBase64) {
    throw new DocumentHttpWireError("Document payload is not valid base64");
  }
  if (encoded.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new DocumentHttpWireError(
      `Base64 document payload exceeds ${maxBytes} bytes`,
    );
  }

  let bytes: Uint8Array;
  try {
    if (typeof Buffer !== "undefined") {
      const buffer = Buffer.from(encoded, "base64");
      bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice();
    } else {
      const binary = atob(encoded);
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
  } catch (error) {
    throw new DocumentHttpWireError("Document payload is not valid base64", {
      cause: error,
    });
  }
  if (bytes.byteLength > maxBytes) {
    throw new DocumentHttpWireError(
      `Base64 document payload exceeds ${maxBytes} bytes`,
    );
  }
  return bytes;
};
