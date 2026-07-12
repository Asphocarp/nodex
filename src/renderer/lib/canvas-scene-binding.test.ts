import { describe, expect, test } from "vitest";
import {
  materializePortableCanvasScene,
  type PortableCanvasScene,
} from "../../shared/block-documents";
import { CanvasSceneBinding } from "./canvas-scene-binding";
import type {
  CanvasSceneObservation,
  CanvasSceneProvider,
} from "./canvas-scene-provider";

const element = (version: number, overrides: Record<string, unknown> = {}) => ({
  id: "element-1",
  type: "rectangle",
  index: "a0",
  version,
  versionNonce: 10,
  isDeleted: false,
  ...overrides,
});

class StubSceneProvider {
  scene: PortableCanvasScene = materializePortableCanvasScene({
    elements: [element(1)],
    appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
  });
  readonly submissions: CanvasSceneObservation[] = [];
  flushCount = 0;
  submitGate: Promise<void> = Promise.resolve();

  getScene = (): PortableCanvasScene => this.scene;

  submit = async (observation: CanvasSceneObservation): Promise<void> => {
    this.submissions.push(observation);
    await this.submitGate;
  };

  flush = async (): Promise<void> => {
    this.flushCount += 1;
  };
}

const providerFor = (stub: StubSceneProvider): CanvasSceneProvider =>
  stub as unknown as CanvasSceneProvider;

describe("CanvasSceneBinding", () => {
  test("forwards including-deleted element candidates to scene-native sync", async () => {
    const provider = new StubSceneProvider();
    const binding = new CanvasSceneBinding({
      provider: providerFor(provider),
      onRemoteScene: () => undefined,
    });
    await binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => [
        element(2),
        element(1, { id: "deleted", isDeleted: true, index: "a1" }),
      ],
      appState: provider.scene.appState,
      binaryFiles: {},
    });
    expect(provider.submissions).toHaveLength(1);
    expect(provider.submissions[0]?.elementCandidates.some(
      (candidate) => candidate.id === "deleted" && candidate.isDeleted === true,
    )).toBe(true);
  });

  test("coalesces observations while an image upload is pending", async () => {
    const provider = new StubSceneProvider();
    let releaseUpload = (): void => undefined;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const binding = new CanvasSceneBinding({
      provider: providerFor(provider),
      assetDependencies: {
        uploadImage: async () => {
          await uploadGate;
          return "nodex://assets/image.png";
        },
      },
      onRemoteScene: () => undefined,
    });
    const binaryFiles = {
      image: {
        id: "image",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,AA==",
        created: 1,
      },
    };
    const first = binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => [
        element(2, { type: "image", fileId: "image" }),
      ],
      appState: provider.scene.appState,
      binaryFiles,
    });
    await Promise.resolve();
    const second = binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => [
        element(3, { type: "image", fileId: "image", x: 40 }),
      ],
      appState: provider.scene.appState,
      binaryFiles,
    });
    releaseUpload();
    await Promise.all([first, second]);
    expect(provider.submissions).toHaveLength(1);
    expect(provider.submissions[0]?.elementCandidates[0]?.version).toBe(3);
    expect(provider.submissions[0]?.fileAdditions?.image?.source).toBe(
      "nodex://assets/image.png",
    );
  });

  test("presents non-conflicting pending app-state intent over a remote scene", async () => {
    const provider = new StubSceneProvider();
    let releaseSubmit = (): void => undefined;
    provider.submitGate = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    let presented: PortableCanvasScene | null = null;
    const binding = new CanvasSceneBinding({
      provider: providerFor(provider),
      onRemoteScene: (scene) => {
        presented = scene;
      },
    });
    const submission = binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => [element(2)],
      appState: { gridSize: 30, viewBackgroundColor: "#ffffff" },
      binaryFiles: {},
    });
    await Promise.resolve();
    binding.presentRemoteScene(materializePortableCanvasScene({
      elements: [element(1)],
      appState: { gridSize: 20, viewBackgroundColor: "#101010" },
    }));
    expect((presented as PortableCanvasScene | null)?.appState.gridSize).toBe(30);
    expect(
      (presented as PortableCanvasScene | null)?.appState.viewBackgroundColor,
    ).toBe("#101010");
    releaseSubmit();
    await submission;
  });

  test("flush waits for upload/submission work before flushing the provider", async () => {
    const provider = new StubSceneProvider();
    let releaseSubmit = (): void => undefined;
    provider.submitGate = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    const binding = new CanvasSceneBinding({
      provider: providerFor(provider),
      onRemoteScene: () => undefined,
    });
    const submission = binding.submitLocalScene({
      getSceneElementsIncludingDeleted: () => [element(2)],
      appState: provider.scene.appState,
      binaryFiles: {},
    });
    let flushed = false;
    const flushing = binding.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    releaseSubmit();
    await Promise.all([submission, flushing]);
    expect(provider.flushCount).toBe(1);
  });
});
