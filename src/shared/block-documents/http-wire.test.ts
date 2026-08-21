import { describe, expect, test } from "vitest";
import {
  DocumentHttpWireError,
  decodeDocumentHttpEnvelope,
  documentBytesFromBase64,
  documentBytesToBase64,
  encodeDocumentHttpEnvelope,
} from "./http-wire";

interface TestMetadata {
  readonly documentId: string;
  readonly touchedBlockIds: readonly string[];
}

const validateTestMetadata = (value: unknown): TestMetadata => {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("metadata must be an object");
  }
  const candidate = value as Partial<TestMetadata>;
  if (
    typeof candidate.documentId !== "string" ||
    !Array.isArray(candidate.touchedBlockIds) ||
    candidate.touchedBlockIds.some((entry) => typeof entry !== "string")
  ) {
    throw new TypeError("metadata fields are invalid");
  }
  return {
    documentId: candidate.documentId,
    touchedBlockIds: candidate.touchedBlockIds as readonly string[],
  };
};

describe("Document HTTP binary wire", () => {
  test("round-trips bounded metadata and binary payload without header limits", () => {
    const touchedBlockIds = Array.from({ length: 1_000 }, (_value, index) => `block-${index}`);
    const payload = Uint8Array.from([0, 1, 2, 127, 128, 255]);
    const encoded = encodeDocumentHttpEnvelope(
      { documentId: "document-1", touchedBlockIds },
      payload,
    );

    const decoded = decodeDocumentHttpEnvelope(encoded, validateTestMetadata, payload.byteLength);

    expect(decoded.metadata.documentId).toBe("document-1");
    expect(decoded.metadata.touchedBlockIds.length).toBe(1_000);
    expect(Array.from(decoded.payload).join(",")).toBe("0,1,2,127,128,255");
  });

  test("rejects truncated, wrong-version, oversized, and invalid metadata", () => {
    const valid = encodeDocumentHttpEnvelope(
      { documentId: "document-1", touchedBlockIds: [] },
      Uint8Array.from([1, 2]),
    );
    const corruptVersion = valid.slice();
    corruptVersion[0] = 0;

    const failures = [
      () => decodeDocumentHttpEnvelope(valid.subarray(0, 7), validateTestMetadata, 2),
      () => decodeDocumentHttpEnvelope(corruptVersion, validateTestMetadata, 2),
      () => decodeDocumentHttpEnvelope(valid, validateTestMetadata, 1),
      () =>
        decodeDocumentHttpEnvelope(
          encodeDocumentHttpEnvelope({ unexpected: true }, new Uint8Array()),
          validateTestMetadata,
          0,
        ),
    ];

    expect(
      failures.every((run) => {
        try {
          run();
          return false;
        } catch (error) {
          return error instanceof DocumentHttpWireError;
        }
      }),
    ).toBe(true);
  });

  test("base64 conversion is byte-exact and bounded", () => {
    const bytes = Uint8Array.from([0, 17, 128, 254, 255]);
    const encoded = documentBytesToBase64(bytes);

    expect(Array.from(documentBytesFromBase64(encoded, 5)).join(",")).toBe("0,17,128,254,255");

    let oversized = false;
    try {
      documentBytesFromBase64(encoded, 4);
    } catch (error) {
      oversized = error instanceof DocumentHttpWireError;
    }
    expect(oversized).toBe(true);

    let malformed = false;
    try {
      documentBytesFromBase64("@@==", 4);
    } catch (error) {
      malformed = error instanceof DocumentHttpWireError;
    }
    expect(malformed).toBe(true);
  });
});
