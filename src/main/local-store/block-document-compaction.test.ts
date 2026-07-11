import { describe, expect, test } from "bun:test";
import type { BlockDocumentCompactionCandidate } from "./block-document-compaction";
import { selectBlockDocumentCompactionBatch } from "./block-document-compaction";

const candidate = (
  documentId: string,
  updateBytes: number,
): BlockDocumentCompactionCandidate => ({
  documentId,
  projectId: "project",
  ownerBlockId: `owner:${documentId}`,
  generation: 1,
  headSeq: 10,
  updateCount: 10,
  updateBytes,
  oldestCommittedAt: "2026-07-11T00:00:00.000Z",
  newestCommittedAt: "2026-07-11T00:01:00.000Z",
});

describe("Block Document compaction batch policy", () => {
  test("bounds document count and encoded tail bytes without starving one large Document", () => {
    const selected = selectBlockDocumentCompactionBatch(
      [
        candidate("oversized", 120),
        candidate("small-a", 20),
        candidate("small-b", 20),
      ],
      {
        maximumDocuments: 2,
        maximumTailBytes: 100,
        scanLimit: 3,
      },
    );
    expect(selected.map((entry) => entry.documentId).join(",")).toBe(
      "oversized",
    );
  });

  test("skips a candidate that would exhaust the byte budget and admits a later fit", () => {
    const selected = selectBlockDocumentCompactionBatch(
      [
        candidate("first", 60),
        candidate("too-large", 60),
        candidate("fits", 30),
        candidate("count-limit", 5),
      ],
      {
        maximumDocuments: 2,
        maximumTailBytes: 100,
        scanLimit: 4,
      },
    );
    expect(selected.map((entry) => entry.documentId).join(",")).toBe(
      "first,fits",
    );
  });

  test("rejects an unbounded maintenance policy", () => {
    let message = "";
    try {
      selectBlockDocumentCompactionBatch([], {
        maximumDocuments: 65,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("maximumDocuments must be an integer between 1 and 64");
  });
});
