import { describe, expect, test } from "vite-plus/test";
import { createCanvasElementChangeTracker } from "./canvas-element-change-tracker";
import {
  canvasElement,
  representativeCanvasElements,
} from "./canvas-element-change-tracker.test-fixtures";

describe("createCanvasElementChangeTracker", () => {
  test("seeds the initial presentation without emitting candidates", () => {
    const initial = representativeCanvasElements(3);
    const tracker = createCanvasElementChangeTracker(initial);

    expect(tracker.observeLocal(initial)).toEqual({
      elementCandidates: [],
      changedImageCandidates: [],
    });
  });

  test("emits a deletion as an explicit tombstone", () => {
    const initial = [canvasElement("element-1")];
    const tracker = createCanvasElementChangeTracker(initial);

    const delta = tracker.observeLocal([canvasElement("element-1", 2, { isDeleted: true })]);

    expect(delta.elementCandidates).toEqual([
      expect.objectContaining({
        id: "element-1",
        version: 2,
        isDeleted: true,
      }),
    ]);
  });

  test("keeps an unhanded candidate dirty across unchanged observations", () => {
    const initial = [canvasElement("element-1")];
    const tracker = createCanvasElementChangeTracker(initial);
    const changed = [canvasElement("element-1", 2, { x: 40 })];

    const first = tracker.observeLocal(changed);
    const second = tracker.observeLocal(changed);

    expect(first.elementCandidates).toHaveLength(1);
    expect(second.elementCandidates).toEqual(first.elementCandidates);
    tracker.markHandedOff(second.elementCandidates);
    expect(tracker.observeLocal(changed).elementCandidates).toEqual([]);
  });

  test("does not let remote presentation clear a dirty local candidate", () => {
    const initial = [canvasElement("element-1"), canvasElement("element-2")];
    const tracker = createCanvasElementChangeTracker(initial);
    const dirty = tracker.observeLocal([
      canvasElement("element-1", 2, { x: 40 }),
      canvasElement("element-2"),
    ]);

    tracker.acceptRemotePresentation(
      [canvasElement("element-1", 3, { x: 80 }), canvasElement("element-2", 2, { x: 20 })],
      new Set(["element-1"]),
    );

    const next = tracker.observeLocal([
      canvasElement("element-1", 2, { x: 40 }),
      canvasElement("element-2", 2, { x: 20 }),
    ]);
    expect(next.elementCandidates).toEqual(dirty.elementCandidates);
  });

  test("advances clean remote elements so their presentation does not echo", () => {
    const initial = [canvasElement("element-1")];
    const tracker = createCanvasElementChangeTracker(initial);
    const remote = [canvasElement("element-1", 2, { x: 40 })];

    tracker.acceptRemotePresentation(remote, new Set());

    expect(tracker.observeLocal(remote).elementCandidates).toEqual([]);
  });

  test("tracks only changed live image elements for asset discovery", () => {
    const initial = [
      canvasElement("element-1"),
      canvasElement("image-1", 1, { type: "image", fileId: "file-1" }),
    ];
    const tracker = createCanvasElementChangeTracker(initial);

    const delta = tracker.observeLocal([
      canvasElement("element-1"),
      canvasElement("image-1", 2, { type: "image", fileId: "file-1", x: 20 }),
    ]);

    expect(delta.changedImageCandidates).toEqual(delta.elementCandidates);
    tracker.markRejected(delta.elementCandidates);
    expect(
      tracker.observeLocal([
        canvasElement("element-1"),
        canvasElement("image-1", 2, { type: "image", fileId: "file-1", x: 20 }),
      ]).changedImageCandidates,
    ).toHaveLength(1);
  });
});
