import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
  applyCanvasSceneSnapshot,
  createCanvasDocument,
  inspectCanvasDocument,
  openCanvasDocument,
} from "../../shared/block-documents";
import { CanvasSceneBinding } from "./canvas-scene-binding";

const element = (
  id: string,
  text: string,
  version: number,
  isDeleted = false,
) => ({
  id,
  type: "text",
  version,
  versionNonce: 10,
  isDeleted,
  index: id,
  text,
});

describe("CanvasSceneBinding", () => {
  test("requires the including-deleted getter and suppresses local echo", async () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:binding",
      initialScene: { elements: [element("one", "one", 1)] },
    });
    let getterCalls = 0;
    let remotePresentations = 0;
    const binding = new CanvasSceneBinding({
      envelope,
      onRemoteScene: () => {
        remotePresentations += 1;
      },
    });
    await binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => {
        getterCalls += 1;
        return [
          element("one", "one", 1),
          element("deleted", "", 1, true),
        ];
      },
      appState: {},
      binaryFiles: {},
    });
    expect(getterCalls).toBe(1);
    expect(remotePresentations).toBe(0);
    expect(
      inspectCanvasDocument(envelope.document).materialization.elements.some(
        (candidate) => candidate.id === "deleted" && candidate.isDeleted === true,
      ),
    ).toBeTrue();
    binding.destroy();
  });

  test("presents remote Yjs transactions without writing an echo", () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:binding-remote",
      initialScene: { elements: [element("one", "one", 1)] },
    });
    const remote = new Y.Doc({ guid: envelope.documentId });
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(envelope.document));
    applyCanvasSceneSnapshot(
      openCanvasDocument({ documentId: envelope.documentId, document: remote }),
      { elements: [element("one", "remote", 2)] },
      "remote-client",
    );
    const before = Y.encodeStateVector(envelope.document);
    let presented = "";
    const binding = new CanvasSceneBinding({
      envelope,
      onRemoteScene: (scene) => {
        presented = String(scene.elements[0]?.text ?? "");
      },
    });
    Y.applyUpdate(
      envelope.document,
      Y.encodeStateAsUpdate(remote, before),
      "provider-remote",
    );
    expect(presented).toBe("remote");
    expect(inspectCanvasDocument(envelope.document).envelope.elements.size).toBe(1);
    binding.destroy();
    remote.destroy();
  });

  test("rebases a stale upload over remote files and coalesces queued observations", async () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:binding-upload-race",
      initialScene: { elements: [] },
    });
    let releaseUpload = (): void => undefined;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    let uploadCount = 0;
    let transactionCount = 0;
    envelope.document.on("afterTransaction", () => {
      transactionCount += 1;
    });
    const binding = new CanvasSceneBinding({
      envelope,
      assetDependencies: {
        uploadImage: async () => {
          uploadCount += 1;
          await uploadGate;
          return "nodex://assets/local.png";
        },
      },
      onRemoteScene: () => undefined,
    });
    const localImage = {
      ...element("local-image", "", 1),
      type: "image",
      fileId: "local-file",
    };
    const first = binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => [localImage],
      appState: {},
      binaryFiles: {
        "local-file": {
          id: "local-file",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,AA==",
          created: 1,
        },
      },
    });
    await Promise.resolve();

    const second = binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => [
        { ...localImage, version: 2, x: 10 },
      ],
      appState: {},
      binaryFiles: {
        "local-file": {
          id: "local-file",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,AA==",
          created: 1,
        },
      },
    });
    const third = binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => [
        { ...localImage, version: 3, x: 20 },
      ],
      appState: {},
      binaryFiles: {
        "local-file": {
          id: "local-file",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,AA==",
          created: 1,
        },
      },
    });
    const remote = new Y.Doc({ guid: envelope.documentId });
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(envelope.document));
    applyCanvasSceneSnapshot(
      openCanvasDocument({ documentId: envelope.documentId, document: remote }),
      {
        elements: [
          {
            ...element("remote-image", "", 1),
            type: "image",
            fileId: "remote-file",
          },
        ],
        appState: { gridSize: 40 },
        files: {
          "remote-file": {
            id: "remote-file",
            mimeType: "image/png",
            source: "nodex://assets/remote.png",
          },
        },
      },
      "remote-image-client",
    );
    Y.applyUpdate(
      envelope.document,
      Y.encodeStateAsUpdate(remote),
      "provider-remote",
    );
    releaseUpload();
    await Promise.all([first, second, third]);
    const scene = binding.getCurrentScene();
    expect(uploadCount).toBe(1);
    expect(transactionCount).toBe(2);
    expect(Object.keys(scene.files).sort().join(",")).toBe(
      "local-file,remote-file",
    );
    expect(
      scene.elements.some((candidate) => candidate.id === "remote-image"),
    ).toBeTrue();
    expect(
      scene.elements.find((candidate) => candidate.id === "local-image")?.x,
    ).toBe(20);
    expect(scene.appState.gridSize).toBe(40);
    binding.destroy();
    remote.destroy();
  });

  test("presents non-conflicting local appState intent over remote scenes", async () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:binding-app-state",
      initialScene: {
        elements: [element("one", "one", 1)],
        appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
      },
    });
    let presentedGridSize: unknown;
    let presentedBackground: unknown;
    const binding = new CanvasSceneBinding({
      envelope,
      onRemoteScene: (scene) => {
        presentedGridSize = scene.appState.gridSize;
        presentedBackground = scene.appState.viewBackgroundColor;
      },
    });
    const localGridChange = binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => [element("one", "one", 1)],
      appState: { gridSize: 30, viewBackgroundColor: "#ffffff" },
      binaryFiles: {},
    });
    envelope.document.transact(() => {
      envelope.appState.set("viewBackgroundColor", "#101010");
    }, "provider-remote-background");
    expect(presentedGridSize).toBe(30);
    expect(presentedBackground).toBe("#101010");
    await localGridChange;
    expect(binding.getCurrentScene().appState.gridSize).toBe(30);
    expect(binding.getCurrentScene().appState.viewBackgroundColor).toBe(
      "#101010",
    );

    const staleLocalGridChange = binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => [element("one", "one", 1)],
      appState: { gridSize: 50, viewBackgroundColor: "#101010" },
      binaryFiles: {},
    });
    envelope.document.transact(() => {
      envelope.appState.set("gridSize", 40);
    }, "provider-remote-grid");
    expect(presentedGridSize).toBe(40);
    await staleLocalGridChange;
    expect(binding.getCurrentScene().appState.gridSize).toBe(40);
    binding.destroy();
  });

  test("reports upload failure through submit and flush, then permits retry", async () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:binding-upload-retry",
      initialScene: { elements: [] },
    });
    let uploadCount = 0;
    let errorCount = 0;
    const binding = new CanvasSceneBinding({
      envelope,
      assetDependencies: {
        uploadImage: async () => {
          uploadCount += 1;
          if (uploadCount === 1) throw new Error("upload unavailable");
          return "nodex://assets/retried.png";
        },
      },
      onRemoteScene: () => undefined,
      onError: () => {
        errorCount += 1;
      },
    });
    const image = {
      ...element("image", "", 1),
      type: "image",
      fileId: "image-file",
    };
    const observation = {
      getSceneElementsIncludingDeleted: () => [image],
      appState: { gridSize: 20 },
      binaryFiles: {
        "image-file": {
          id: "image-file",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,AA==",
          created: 1,
        },
      },
    } as const;
    let submitError: unknown;
    try {
      await binding.submitLocalScene(observation);
    } catch (error) {
      submitError = error;
    }
    let flushError: unknown;
    try {
      await binding.flush();
    } catch (error) {
      flushError = error;
    }
    expect(submitError instanceof Error).toBeTrue();
    expect(flushError instanceof Error).toBeTrue();
    expect(errorCount).toBe(1);
    expect(binding.getCurrentScene().elements.length).toBe(0);

    const retry = binding.submitLocalScene(observation);
    await Promise.all([retry, binding.flush()]);
    expect(uploadCount).toBe(2);
    expect(Object.keys(binding.getCurrentScene().files).join(",")).toBe(
      "image-file",
    );
    expect(binding.getCurrentScene().appState.gridSize).toBe(20);
    await binding.flush();
    binding.destroy();
  });

  test("registers one upload-aware flush for persist and relocation fences", async () => {
    const envelope = createCanvasDocument({
      documentId: "document:canvas:binding-preparers",
      initialScene: { elements: [] },
    });
    let releaseUpload = (): void => undefined;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const binding = new CanvasSceneBinding({
      envelope,
      assetDependencies: {
        uploadImage: async () => {
          await uploadGate;
          return "nodex://assets/prepared.png";
        },
      },
      onRemoteScene: () => undefined,
    });
    let persistPreparer = (): void | Promise<void> => undefined;
    let relocationPreparer = (): void | Promise<void> => undefined;
    let unregisterCount = 0;
    const unregister = binding.registerSurfacePreparers({
      registerPersistPreparer: (preparer) => {
        persistPreparer = preparer;
        return () => {
          unregisterCount += 1;
        };
      },
      registerRelocationPreparer: (preparer) => {
        relocationPreparer = () => preparer({} as never);
        return () => {
          unregisterCount += 1;
        };
      },
    });
    const submission = binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => [{
        ...element("prepared", "", 1),
        type: "image",
        fileId: "prepared-file",
      }],
      appState: {},
      binaryFiles: {
        "prepared-file": {
          id: "prepared-file",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,AA==",
          created: 1,
        },
      },
    });
    let persistCompleted = false;
    const persisted = Promise.resolve(persistPreparer()).then(() => {
      persistCompleted = true;
    });
    const relocated = Promise.resolve(relocationPreparer());
    await Promise.resolve();
    expect(persistCompleted).toBeFalse();
    releaseUpload();
    await Promise.all([submission, persisted, relocated]);
    expect(persistCompleted).toBeTrue();
    unregister();
    unregister();
    expect(unregisterCount).toBe(2);
    binding.destroy();
  });
});
