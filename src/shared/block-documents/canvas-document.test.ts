import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  CanvasDocumentSchemaError,
  applyCanvasForwardRestorePlan,
  applyRebasedCanvasSceneObservation,
  applyCanvasSceneSnapshot,
  canonicalCanvasSceneFingerprint,
  canonicalCanvasSceneSemanticFingerprint,
  canvasElementRevisionKey,
  chooseCanvasElementWinner,
  compileCanvasForwardRestorePlan,
  createCanvasDocument,
  inspectCanvasDocument,
  parseCanvasSceneMaterialization,
} from "./canvas-document";

const element = (
  id: string,
  input: {
    readonly version?: number;
    readonly versionNonce?: number;
    readonly isDeleted?: boolean;
    readonly index?: string;
    readonly text?: string;
    readonly x?: number;
  } = {},
) => ({
  id,
  type: "text",
  version: input.version ?? 1,
  versionNonce: input.versionNonce ?? 100,
  isDeleted: input.isDeleted ?? false,
  index: input.index ?? "a0",
  text: input.text ?? id,
  x: input.x ?? 0,
});

const materializedElementsJson = (document: Y.Doc): string =>
  JSON.stringify(inspectCanvasDocument(document).materialization.elements);

const cloneFromUpdate = (documentId: string, update: Uint8Array): Y.Doc => {
  const document = new Y.Doc({ guid: documentId });
  Y.applyUpdate(document, update);
  return document;
};

const mergeInOrder = (
  documentId: string,
  genesis: Uint8Array,
  updates: readonly Uint8Array[],
): Y.Doc => {
  const document = cloneFromUpdate(documentId, genesis);
  updates.forEach((update) => Y.applyUpdate(document, update));
  return document;
};

describe("legacy Canvas Y.Doc migration codec", () => {
  test("owns exact scene roots and canonicalizes legacy Card references", () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:roots",
      initialScene: {
        elements: [
          {
            ...element("card-element"),
            customData: {
              type: "nodex-card",
              cardId: "card-1",
              columnId: "triage",
            },
            label: { text: "Card title snapshot" },
          },
        ],
        appState: {
          collaborators: { remote: true },
          selectedElementIds: { "card-element": true },
          gridModeEnabled: true,
          gridSize: 20,
          gridStep: 5,
          viewBackgroundColor: "#ffffff",
        },
        files: {
          "file-1": {
            id: "file-1",
            source: "nodex://assets/file-1.png",
            mimeType: "image/png",
          },
        },
      },
    });
    const inspection = inspectCanvasDocument(envelope.document);
    expect(JSON.stringify([...envelope.document.share.keys()].sort())).toBe(
      '["appState","elements","files","order"]',
    );
    expect(JSON.stringify(inspection.materialization.appState)).toBe(
      JSON.stringify({
        gridModeEnabled: true,
        gridSize: 20,
        gridStep: 5,
        viewBackgroundColor: "#ffffff",
      }),
    );
    expect(JSON.stringify(inspection.materialization.pageReferences)).toBe(
      JSON.stringify([
        {
          sourceElementId: "card-element",
          targetBlockId: "card-1",
          titleHint: "Card title snapshot",
        },
      ]),
    );
    const customData = inspection.materialization.elements[0]?.customData as
      | Readonly<Record<string, unknown>>
      | undefined;
    expect(customData?.type).toBe("nodex-card-reference");
    expect(customData?.targetBlockId).toBe("card-1");
    expect(customData?.cardId === undefined).toBe(true);
  });

  test("treats appState and files as exact roots without inferring element deletion", () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:exact-roots",
      initialScene: {
        elements: [element("retained")],
        appState: { gridModeEnabled: true, gridSize: 20 },
        files: {
          old: {
            id: "old",
            source: "nodex://assets/old.png",
            mimeType: "image/png",
          },
        },
      },
    });
    applyCanvasSceneSnapshot(envelope, {
      elements: [],
      appState: { gridStep: null, viewBackgroundColor: "#101010" },
      files: {},
    });
    const materialization = inspectCanvasDocument(envelope.document).materialization;
    expect(materialization.elements.length).toBe(1);
    expect(JSON.stringify(materialization.appState)).toBe(
      JSON.stringify({ gridStep: null, viewBackgroundColor: "#101010" }),
    );
    expect(Object.keys(materialization.files).length).toBe(0);
  });

  test("atomically rebases local intent over current winners, files, and appState", () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:rebased-observation",
      initialScene: {
        elements: [
          {
            ...element("local", { version: 1 }),
            type: "image",
            fileId: "local-file",
          },
        ],
        appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
        files: {
          "local-file": {
            id: "local-file",
            source: "nodex://assets/local.png",
            mimeType: "image/png",
          },
        },
      },
    });
    applyCanvasSceneSnapshot(
      envelope,
      {
        elements: [
          {
            ...element("remote", { version: 1, index: "a1" }),
            type: "image",
            fileId: "remote-file",
          },
        ],
        appState: { gridSize: 40, viewBackgroundColor: "#ffffff" },
        files: {
          "local-file": {
            id: "local-file",
            source: "nodex://assets/local.png",
            mimeType: "image/png",
          },
          "remote-file": {
            id: "remote-file",
            source: "nodex://assets/remote.png",
            mimeType: "image/png",
          },
        },
      },
      "remote-before-upload",
    );
    let transactionCount = 0;
    envelope.document.on("afterTransaction", () => {
      transactionCount += 1;
    });

    applyRebasedCanvasSceneObservation(envelope, {
      elementsIncludingDeleted: [
        {
          ...element("local", { version: 2, x: 25 }),
          type: "image",
          fileId: "local-file",
        },
      ],
      appStatePatch: {
        gridSize: { expected: 20, value: 30 },
        viewBackgroundColor: { expected: "#ffffff", value: "#101010" },
      },
      fileAdditions: {
        "local-file": {
          id: "local-file",
          source: "nodex://assets/local.png",
          mimeType: "image/png",
        },
      },
    });

    const materialization = inspectCanvasDocument(envelope.document).materialization;
    expect(transactionCount).toBe(1);
    expect(materialization.appState.gridSize).toBe(40);
    expect(materialization.appState.viewBackgroundColor).toBe("#101010");
    expect(Object.keys(materialization.files).sort().join(",")).toBe("local-file,remote-file");
    expect(materialization.elements.find((candidate) => candidate.id === "local")?.x).toBe(25);
    expect(materialization.elements.some((candidate) => candidate.id === "remote")).toBe(true);
  });

  test("prunes an uploaded file when the post-merge remote element wins", () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:rebased-file-winner",
      initialScene: {
        elements: [
          {
            ...element("image", { version: 2, versionNonce: 10 }),
            type: "image",
            fileId: "remote-file",
          },
        ],
        files: {
          "remote-file": {
            id: "remote-file",
            source: "nodex://assets/remote.png",
            mimeType: "image/png",
          },
        },
      },
    });
    applyRebasedCanvasSceneObservation(envelope, {
      elementsIncludingDeleted: [
        {
          ...element("image", { version: 1, versionNonce: 20 }),
          type: "image",
          fileId: "stale-file",
        },
      ],
      appStatePatch: {},
      fileAdditions: {
        "stale-file": {
          id: "stale-file",
          source: "nodex://assets/stale.png",
          mimeType: "image/png",
        },
      },
    });
    const materialization = inspectCanvasDocument(envelope.document).materialization;
    expect(Object.keys(materialization.files).join(",")).toBe("remote-file");
    expect(materialization.elements[0]?.fileId).toBe("remote-file");
  });

  test("rejects unsupported roots and malformed revision keys", () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:invalid",
      initialScene: { elements: [element("one")] },
    });
    envelope.document.getMap("foreign").set("body", "not a scene root");
    let rootError: unknown;
    try {
      inspectCanvasDocument(envelope.document);
    } catch (error) {
      rootError = error;
    }
    expect(rootError instanceof CanvasDocumentSchemaError).toBe(true);

    const malformed = createCanvasDocument({
      documentId: "document:canvas:bad-key",
    });
    malformed.elements.set("element-id", element("element-id"));
    let keyError: unknown;
    try {
      inspectCanvasDocument(malformed.document);
    } catch (error) {
      keyError = error;
    }
    expect(keyError instanceof CanvasDocumentSchemaError).toBe(true);
  });

  test("keeps stored Canvas elements strictly portable", () => {
    let error: unknown;
    try {
      createCanvasDocument({
        documentId: "document:canvas:stored-undefined",
        initialScene: {
          elements: [{ ...element("undefined"), customData: undefined }],
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof CanvasDocumentSchemaError).toBe(true);
  });

  test("rejects inline file payloads before they can enter the Y.Doc", () => {
    let error: unknown;
    try {
      createCanvasDocument({
        documentId: "document:canvas:inline-file",
        initialScene: {
          elements: [],
          files: {
            inline: {
              id: "inline",
              mimeType: "image/png",
              dataURL: "data:image/png;base64,AA==",
            },
          },
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof CanvasDocumentSchemaError).toBe(true);
  });

  test("rejects non-canonical managed asset URIs", () => {
    let error: unknown;
    try {
      createCanvasDocument({
        documentId: "document:canvas:non-canonical-asset",
        initialScene: {
          elements: [],
          files: {
            encoded: {
              id: "encoded",
              mimeType: "image/png",
              source: "nodex://assets/%66ile.png",
            },
          },
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof CanvasDocumentSchemaError).toBe(true);
  });

  test("fails closed when a stored derived projection is tampered", () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:stored-corruption",
      initialScene: {
        elements: [element("text", { text: "Derived text" })],
      },
    });
    const materialization = inspectCanvasDocument(envelope.document).materialization;
    let error: unknown;
    try {
      parseCanvasSceneMaterialization({
        documentId: envelope.documentId,
        value: { ...materialization, plainText: "tampered" },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof CanvasDocumentSchemaError).toBe(true);
  });

  test("canonicalizes trusted scene state beyond the public update envelope", () => {
    const largeText = "canvas-state-".repeat(65_000);
    const envelope = createCanvasDocument({
      documentId: "document:canvas:trusted-large-state",
      initialScene: {
        elements: [
          element("large-a", { index: "a0", text: `${largeText}:a` }),
          element("large-b", { index: "a1", text: `${largeText}:b` }),
          element("large-c", { index: "a2", text: `${largeText}:c` }),
        ],
      },
    });
    const materialization = inspectCanvasDocument(envelope.document).materialization;
    expect(Y.encodeStateAsUpdate(envelope.document).byteLength > 2 * 1024 * 1024).toBe(true);
    const parsed = parseCanvasSceneMaterialization({
      documentId: envelope.documentId,
      value: materialization,
    });
    expect(canonicalCanvasSceneFingerprint(parsed)).toBe(
      canonicalCanvasSceneFingerprint(materialization),
    );
  });

  test("keeps same-element contenders visible and converges in opposite update order", () => {
    const base = createCanvasDocument({
      documentId: "document:canvas:concurrent",
      initialScene: { elements: [element("same", { index: "a0" })] },
    });
    const genesis = Y.encodeStateAsUpdate(base.document);
    const baseline = Y.encodeStateVector(base.document);
    const first = cloneFromUpdate("document:canvas:concurrent", genesis);
    const second = cloneFromUpdate("document:canvas:concurrent", genesis);
    applyCanvasSceneSnapshot(
      inspectCanvasDocument(first).envelope,
      {
        elements: [
          element("same", {
            version: 2,
            versionNonce: 900,
            text: "first",
            x: 10,
          }),
        ],
      },
      "first-client",
    );
    applyCanvasSceneSnapshot(
      inspectCanvasDocument(second).envelope,
      {
        elements: [
          element("same", {
            version: 2,
            versionNonce: 100,
            text: "second",
            x: 20,
          }),
        ],
      },
      "second-client",
    );
    const firstUpdate = Y.encodeStateAsUpdate(first, baseline);
    const secondUpdate = Y.encodeStateAsUpdate(second, baseline);
    const left = mergeInOrder("document:canvas:concurrent", genesis, [firstUpdate, secondUpdate]);
    const right = mergeInOrder("document:canvas:concurrent", genesis, [secondUpdate, firstUpdate]);
    expect(materializedElementsJson(left)).toBe(materializedElementsJson(right));
    expect(inspectCanvasDocument(left).materialization.elements[0]?.text).toBe("second");
    expect(inspectCanvasDocument(left).envelope.elements.size).toBe(2);
    expect(Array.from(Y.encodeStateVector(left)).join(",")).toBe(
      Array.from(Y.encodeStateVector(right)).join(","),
    );
  });

  test("uses canonical payload as the final equal-version and nonce tie-break", () => {
    const left = element("same", {
      version: 3,
      versionNonce: 55,
      text: "alpha",
    });
    const right = element("same", {
      version: 3,
      versionNonce: 55,
      text: "omega",
    });
    const winner = chooseCanvasElementWinner(left, right);
    const reverseWinner = chooseCanvasElementWinner(right, left);
    expect(JSON.stringify(winner)).toBe(JSON.stringify(reverseWinner));
    expect(canvasElementRevisionKey(left) === canvasElementRevisionKey(right)).toBe(false);
  });

  test("merges disjoint edits without whole-scene replacement", () => {
    const base = createCanvasDocument({
      documentId: "document:canvas:disjoint",
      initialScene: {
        elements: [element("one", { index: "a0" }), element("two", { index: "a1" })],
      },
    });
    const genesis = Y.encodeStateAsUpdate(base.document);
    const baseline = Y.encodeStateVector(base.document);
    const first = cloneFromUpdate("document:canvas:disjoint", genesis);
    const second = cloneFromUpdate("document:canvas:disjoint", genesis);
    applyCanvasSceneSnapshot(inspectCanvasDocument(first).envelope, {
      elements: [element("one", { version: 2, text: "one changed" })],
    });
    applyCanvasSceneSnapshot(inspectCanvasDocument(second).envelope, {
      elements: [element("two", { version: 2, text: "two changed", index: "a1" })],
    });
    const merged = mergeInOrder("document:canvas:disjoint", genesis, [
      Y.encodeStateAsUpdate(first, baseline),
      Y.encodeStateAsUpdate(second, baseline),
    ]);
    expect(
      inspectCanvasDocument(merged)
        .materialization.elements.map((entry) => entry.text)
        .join(","),
    ).toBe("one changed,two changed");
  });

  test("converges delete-versus-edit and preserves the winning tombstone", () => {
    const base = createCanvasDocument({
      documentId: "document:canvas:delete-edit",
      initialScene: { elements: [element("same")] },
    });
    const genesis = Y.encodeStateAsUpdate(base.document);
    const baseline = Y.encodeStateVector(base.document);
    const editing = cloneFromUpdate("document:canvas:delete-edit", genesis);
    const deleting = cloneFromUpdate("document:canvas:delete-edit", genesis);
    applyCanvasSceneSnapshot(inspectCanvasDocument(editing).envelope, {
      elements: [
        element("same", {
          version: 2,
          versionNonce: 500,
          text: "edited",
        }),
      ],
    });
    applyCanvasSceneSnapshot(inspectCanvasDocument(deleting).envelope, {
      elements: [
        element("same", {
          version: 2,
          versionNonce: 10,
          isDeleted: true,
          text: "",
        }),
      ],
    });
    const editUpdate = Y.encodeStateAsUpdate(editing, baseline);
    const deleteUpdate = Y.encodeStateAsUpdate(deleting, baseline);
    const left = mergeInOrder("document:canvas:delete-edit", genesis, [editUpdate, deleteUpdate]);
    const right = mergeInOrder("document:canvas:delete-edit", genesis, [deleteUpdate, editUpdate]);
    expect(materializedElementsJson(left)).toBe(materializedElementsJson(right));
    expect(inspectCanvasDocument(left).materialization.elements[0]?.isDeleted).toBe(true);
  });

  test("canonical contender cleanup reaches a no-op without a repair loop", () => {
    const base = createCanvasDocument({
      documentId: "document:canvas:cleanup",
      initialScene: { elements: [element("same")] },
    });
    const genesis = Y.encodeStateAsUpdate(base.document);
    const baseline = Y.encodeStateVector(base.document);
    const first = cloneFromUpdate("document:canvas:cleanup", genesis);
    const second = cloneFromUpdate("document:canvas:cleanup", genesis);
    applyCanvasSceneSnapshot(inspectCanvasDocument(first).envelope, {
      elements: [element("same", { version: 2, versionNonce: 80, text: "first" })],
    });
    applyCanvasSceneSnapshot(inspectCanvasDocument(second).envelope, {
      elements: [element("same", { version: 2, versionNonce: 20, text: "winner" })],
    });
    const merged = mergeInOrder("document:canvas:cleanup", genesis, [
      Y.encodeStateAsUpdate(first, baseline),
      Y.encodeStateAsUpdate(second, baseline),
    ]);
    const winner = inspectCanvasDocument(merged).materialization.elements[0];
    if (!winner) throw new TypeError("Expected a winner");
    const beforeCleanup = Y.encodeStateVector(merged);
    applyCanvasSceneSnapshot(inspectCanvasDocument(merged).envelope, {
      elements: [winner],
    });
    const cleanup = Y.encodeStateAsUpdate(merged, beforeCleanup);
    let noOpUpdateCount = 0;
    const countUpdate = () => {
      noOpUpdateCount += 1;
    };
    merged.on("update", countUpdate);
    applyCanvasSceneSnapshot(inspectCanvasDocument(merged).envelope, {
      elements: [winner],
    });
    merged.off("update", countUpdate);
    expect(cleanup.byteLength > 2).toBe(true);
    expect(noOpUpdateCount).toBe(0);
    expect(inspectCanvasDocument(merged).envelope.elements.size).toBe(1);
  });

  test("restores a checkpoint as a forward update with newer tombstones", () => {
    const targetEnvelope = createCanvasDocument({
      documentId: "document:canvas:forward-restore",
      initialScene: {
        elements: [element("kept", { version: 1, text: "checkpoint" })],
        appState: { gridModeEnabled: true },
        files: {
          target: {
            id: "target",
            source: "nodex://assets/target.png",
            mimeType: "image/png",
          },
        },
      },
    });
    const target = inspectCanvasDocument(targetEnvelope.document).materialization;
    const currentEnvelope = createCanvasDocument({
      documentId: "document:canvas:forward-restore",
      initialScene: {
        elements: [
          element("kept", { version: 5, text: "current" }),
          element("current-only", { version: 7, text: "remove me", index: "a1" }),
        ],
        appState: { gridModeEnabled: false, gridSize: 40 },
        files: {
          current: {
            id: "current",
            source: "nodex://assets/current.png",
            mimeType: "image/png",
          },
        },
      },
    });
    const current = inspectCanvasDocument(currentEnvelope.document).materialization;
    const plan = compileCanvasForwardRestorePlan({
      current,
      target,
      restoreIdentity: "restore:canvas:one",
    });
    const repeatedPlan = compileCanvasForwardRestorePlan({
      current,
      target,
      restoreIdentity: "restore:canvas:one",
    });
    expect(JSON.stringify(plan)).toBe(JSON.stringify(repeatedPlan));

    const beforeUpdate = Y.encodeStateAsUpdate(currentEnvelope.document);
    const beforeVector = Y.encodeStateVector(currentEnvelope.document);
    applyCanvasForwardRestorePlan(currentEnvelope, plan);
    const forwardUpdate = Y.encodeStateAsUpdate(currentEnvelope.document, beforeVector);
    const restored = inspectCanvasDocument(currentEnvelope.document).materialization;
    const kept = restored.elements.find((entry) => entry.id === "kept");
    const removed = restored.elements.find((entry) => entry.id === "current-only");
    expect(kept?.text).toBe("checkpoint");
    expect(kept?.version).toBe(6);
    expect(removed?.isDeleted).toBe(true);
    expect(removed?.version).toBe(8);
    expect(JSON.stringify(restored.appState)).toBe(JSON.stringify({ gridModeEnabled: true }));
    expect(Object.keys(restored.files).join(",")).toBe("target");
    expect(canonicalCanvasSceneSemanticFingerprint(restored)).toBe(
      canonicalCanvasSceneSemanticFingerprint(target),
    );
    expect(forwardUpdate.byteLength > 2).toBe(true);

    const replica = new Y.Doc({ guid: "document:canvas:forward-restore" });
    Y.applyUpdate(replica, beforeUpdate);
    Y.applyUpdate(replica, forwardUpdate);
    expect(materializedElementsJson(replica)).toBe(
      materializedElementsJson(currentEnvelope.document),
    );
  });
});
