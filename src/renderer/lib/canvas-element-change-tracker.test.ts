import { describe, expect, test } from "vitest";
import { createCanvasElementChangeTracker } from "./canvas-element-change-tracker";

const element = (
  id: string,
  version = 1,
  overrides: Readonly<Record<string, unknown>> = {},
) => ({
  id,
  type: "rectangle",
  index: `a${id.padStart(5, "0")}`,
  version,
  versionNonce: 10,
  isDeleted: false,
  x: Number(id.replace(/\D/gu, "")) || 0,
  ...overrides,
});

const representativeElements = (count: number) =>
  Array.from({ length: count }, (_, index) => element(`element-${index}`));

describe("createCanvasElementChangeTracker", () => {
  test("seeds the initial presentation without emitting candidates", () => {
    const initial = representativeElements(3);
    const tracker = createCanvasElementChangeTracker(initial);

    expect(tracker.observeLocal(initial)).toEqual({
      elementCandidates: [],
      changedImageCandidates: [],
    });
  });

  test("emits one candidate for one changed element in a 10,000 element scene", () => {
    const initial = representativeElements(10_000);
    const tracker = createCanvasElementChangeTracker(initial);
    const next = [...initial];
    next[7_777] = element("element-7777", 2, { x: 900 });

    const delta = tracker.observeLocal(next);

    expect(delta.elementCandidates).toHaveLength(1);
    expect(delta.elementCandidates[0]).toMatchObject({
      id: "element-7777",
      version: 2,
      x: 900,
    });
  });

  test("emits a deletion as an explicit tombstone", () => {
    const initial = [element("element-1")];
    const tracker = createCanvasElementChangeTracker(initial);

    const delta = tracker.observeLocal([
      element("element-1", 2, { isDeleted: true }),
    ]);

    expect(delta.elementCandidates).toEqual([
      expect.objectContaining({
        id: "element-1",
        version: 2,
        isDeleted: true,
      }),
    ]);
  });

  test("keeps an unhanded candidate dirty across unchanged observations", () => {
    const initial = [element("element-1")];
    const tracker = createCanvasElementChangeTracker(initial);
    const changed = [element("element-1", 2, { x: 40 })];

    const first = tracker.observeLocal(changed);
    const second = tracker.observeLocal(changed);

    expect(first.elementCandidates).toHaveLength(1);
    expect(second.elementCandidates).toEqual(first.elementCandidates);
    tracker.markHandedOff(second.elementCandidates);
    expect(tracker.observeLocal(changed).elementCandidates).toEqual([]);
  });

  test("does not let remote presentation clear a dirty local candidate", () => {
    const initial = [element("element-1"), element("element-2")];
    const tracker = createCanvasElementChangeTracker(initial);
    const dirty = tracker.observeLocal([
      element("element-1", 2, { x: 40 }),
      element("element-2"),
    ]);

    tracker.acceptRemotePresentation(
      [element("element-1", 3, { x: 80 }), element("element-2", 2, { x: 20 })],
      new Set(["element-1"]),
    );

    const next = tracker.observeLocal([
      element("element-1", 2, { x: 40 }),
      element("element-2", 2, { x: 20 }),
    ]);
    expect(next.elementCandidates).toEqual(dirty.elementCandidates);
  });

  test("advances clean remote elements so their presentation does not echo", () => {
    const initial = [element("element-1")];
    const tracker = createCanvasElementChangeTracker(initial);
    const remote = [element("element-1", 2, { x: 40 })];

    tracker.acceptRemotePresentation(remote, new Set());

    expect(tracker.observeLocal(remote).elementCandidates).toEqual([]);
  });

  test("tracks only changed live image elements for asset discovery", () => {
    const initial = [
      element("element-1"),
      element("image-1", 1, { type: "image", fileId: "file-1" }),
    ];
    const tracker = createCanvasElementChangeTracker(initial);

    const delta = tracker.observeLocal([
      element("element-1"),
      element("image-1", 2, { type: "image", fileId: "file-1", x: 20 }),
    ]);

    expect(delta.changedImageCandidates).toEqual(delta.elementCandidates);
    tracker.markRejected(delta.elementCandidates);
    expect(
      tracker.observeLocal([
        element("element-1"),
        element("image-1", 2, { type: "image", fileId: "file-1", x: 20 }),
      ]).changedImageCandidates,
    ).toHaveLength(1);
  });
});
