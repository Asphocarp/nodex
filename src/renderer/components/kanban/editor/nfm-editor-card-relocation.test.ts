import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import type { OwnedBlockDocumentDescriptor } from "../../../../shared/block-documents/contracts";
import type { NfmEditorCollaborativeDocumentSource } from "./nfm-editor-source";
import {
  buildCardBlockRelocationRequest,
  executeCardBlockRelocation,
} from "./nfm-editor-card-relocation";

const sourceDocument = new Y.Doc({ guid: "source-document" });
const source: NfmEditorCollaborativeDocumentSource = {
  kind: "collaborative-document",
  documentId: "source-document",
  storeEpoch: "store-1",
  generation: 2,
  clientSessionId: "surface-1",
  fragment: sourceDocument.getXmlFragment("body"),
  user: { name: "You", color: "blue" },
};
const target: OwnedBlockDocumentDescriptor = {
  projectId: "project-1",
  ownerBlockId: "card-2",
  ownerType: "card",
  ownerLifecycle: "active",
  documentId: "target-document",
  storeEpoch: "store-1",
  generation: 3,
  headSeq: 4,
  schemaKey: "nodex.card",
  schemaVersion: 1,
  readiness: "ready",
  authority: "ydoc_primary",
  stateVector: new Uint8Array([0]),
};

const build = (
  overrides: Partial<
    Parameters<typeof buildCardBlockRelocationRequest>[0]
  > = {},
) =>
  buildCardBlockRelocationRequest({
    projectId: "project-1",
    source,
    sourceCardId: "card-1",
    rootBlockIds: ["block-1", "block-2"],
    targetCardId: "card-2",
    target,
    createRelocationId: () => "move-1",
    ...overrides,
  });

const throws = (operation: () => unknown): boolean => {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
};

describe("NFM editor Card relocation request", () => {
  test("builds a session-bound logical intent without stale heads", () => {
    const request = build();

    expect(request.clientSessionId).toBe("surface-1");
    expect(request.intent.sourceDocumentId).toBe("source-document");
    expect(request.intent.sourceGeneration).toBe(2);
    expect(request.intent.target.documentId).toBe("target-document");
    expect(request.intent.target.generation).toBe(3);
    expect("expectedSourceHeadSeq" in request.intent).toBe(false);
  });

  test("rejects self, cross-Project, stale-epoch, and duplicate-ID moves", () => {
    expect(throws(() => build({ targetCardId: "card-1" }))).toBe(true);
    expect(
      throws(() =>
        build({ target: { ...target, projectId: "project-other" } }),
      ),
    ).toBe(true);
    expect(
      throws(() => build({ target: { ...target, storeEpoch: "store-other" } })),
    ).toBe(true);
    expect(
      throws(() => build({ rootBlockIds: ["block-1", "block-1"] })),
    ).toBe(true);
  });

  test("retries a lost response with the exact same relocation identity", async () => {
    const request = build();
    const relocationIds: string[] = [];
    const response = await executeCardBlockRelocation(
      request,
      async (attempt) => {
        relocationIds.push(attempt.intent.relocationId);
        if (relocationIds.length === 1) {
          return {
            ok: false,
            error: {
              code: "unknown",
              message: "response lost",
              retryable: true,
              reloadRequired: false,
            },
          };
        }
        return {
          ok: false,
          error: {
            code: "block_not_found",
            message: "test terminal response",
            retryable: false,
            reloadRequired: false,
          },
        };
      },
    );

    expect(relocationIds.join(",")).toBe("move-1,move-1");
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe("block_not_found");
  });
});
