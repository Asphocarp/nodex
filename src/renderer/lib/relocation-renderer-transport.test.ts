import { describe, expect, test } from "bun:test";
import type {
  RelocationIntent,
  RelocationResult,
} from "../../shared/block-documents/contracts";
import {
  decodeRelocationHttpRequest,
  encodeRelocationHttpResult,
  RELOCATION_HTTP_CONTENT_TYPE,
} from "../../shared/block-documents/relocation-transport";
import { browserRendererTransport } from "./browser-renderer-transport";
import {
  createElectronRendererTransport,
  type ElectronRendererBridge,
} from "./electron-renderer-transport";

const intent: RelocationIntent = {
  relocationId: "renderer-move-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  rootBlockIds: ["block-1"],
  sourceDocumentId: "document-1",
  sourceGeneration: 1,
  target: {
    kind: "document",
    documentId: "document-2",
    generation: 2,
  },
};

const result: RelocationResult = {
  relocationId: intent.relocationId,
  projectId: intent.projectId,
  storeEpoch: intent.storeEpoch,
  duplicate: false,
  rootBlockIds: ["block-1"],
  movedBlockIds: ["block-1"],
  finalLocations: {
    "block-1": { kind: "document", documentId: "document-2" },
  },
  finalLocationRevisions: { "block-1": 2 },
  sourceCommit: {
    documentId: "document-1",
    generation: 1,
    baseHeadSeq: 0,
    headSeq: 1,
    updateId: "relocation:source",
    update: new Uint8Array([1]),
    stateVector: new Uint8Array([2]),
  },
  targetCommit: {
    documentId: "document-2",
    generation: 2,
    baseHeadSeq: 4,
    headSeq: 5,
    updateId: "relocation:target",
    update: new Uint8Array([3]),
    stateVector: new Uint8Array([4]),
  },
  changeLogSeq: 6,
  committedAt: "2026-07-11T00:00:00.000Z",
};

describe("Block relocation renderer transports", () => {
  test("browser sends a session-bound logical intent and decodes binary commits", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedSession = "";
    globalThis.fetch = (async (input, init) => {
      capturedUrl = String(input);
      const decoded = decodeRelocationHttpRequest(
        String(init?.body),
        "project-1",
        "document-1",
      );
      capturedSession = decoded.clientSessionId;
      const encoded = encodeRelocationHttpResult(result);
      return new Response(encoded.slice().buffer, {
        status: 200,
        headers: { "Content-Type": RELOCATION_HTTP_CONTENT_TYPE },
      });
    }) as typeof fetch;

    try {
      const response = await browserRendererTransport.relocateBlocks({
        clientSessionId: "surface-1",
        intent,
      });
      expect(response.ok).toBeTrue();
      if (response.ok) {
        expect(response.value.targetCommit?.update?.join(",")).toBe("3");
      }
      expect(capturedSession).toBe("surface-1");
      expect(
        capturedUrl.endsWith(
          "/api/projects/project-1/documents/document-1/relocations",
        ),
      ).toBeTrue();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Electron invokes the same typed relocation command", async () => {
    let capturedChannel = "";
    let capturedSession = "";
    const bridge = {
      invoke: async (channel: string, request: unknown) => {
        capturedChannel = channel;
        capturedSession = (request as { readonly clientSessionId: string })
          .clientSessionId;
        return { ok: true, value: result };
      },
    } as unknown as ElectronRendererBridge;
    const response = await createElectronRendererTransport(
      bridge,
    ).relocateBlocks({ clientSessionId: "surface-2", intent });

    expect(response.ok).toBeTrue();
    expect(capturedChannel).toBe("document-sync:relocate");
    expect(capturedSession).toBe("surface-2");
  });
});
