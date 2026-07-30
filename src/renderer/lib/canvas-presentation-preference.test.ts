import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createCanvasInlineFramePersistence,
  createCanvasViewportPersistence,
  DEFAULT_CANVAS_INLINE_FRAME_HEIGHT_PX,
  getCanvasInlineFramePreferenceStorageKey,
  getCanvasViewportPreferenceStorageKey,
  makeCanvasViewportPreferenceScope,
  MAX_CANVAS_INLINE_FRAME_HEIGHT_PX,
  MIN_CANVAS_INLINE_FRAME_HEIGHT_PX,
  normalizeCanvasInlineFramePreference,
  normalizeCanvasViewportPreference,
  readCanvasInlineFramePreference,
  readCanvasViewportPreference,
  writeCanvasInlineFramePreference,
  writeCanvasViewportPreference,
} from "./canvas-presentation-preference";

const identity = {
  storeEpoch: "epoch:test",
  documentId: "document:canvas",
  preferenceScope: "stage:tab-1",
};

describe("Canvas viewport preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("round-trips one profile-local Document viewport with exact isolation", () => {
    writeCanvasViewportPreference(identity, {
      scrollX: -240.5,
      scrollY: 180.25,
      zoom: 1.5,
    });

    expect(readCanvasViewportPreference(identity)).toEqual({
      scrollX: -240.5,
      scrollY: 180.25,
      zoom: 1.5,
    });
    expect(readCanvasViewportPreference({
      ...identity,
      storeEpoch: "epoch:other",
    })).toBeNull();
    expect(readCanvasViewportPreference({
      ...identity,
      documentId: "document:other",
    })).toBeNull();
    expect(readCanvasViewportPreference({
      ...identity,
      preferenceScope: "inline:canvas-1",
    })).toBeNull();
  });

  test("migrates the current tab-scoped Stage viewport to its stable scope", () => {
    const legacyIdentity = {
      ...identity,
      preferenceScope: JSON.stringify([
        "stage",
        "window-1",
        "session-1",
        "closed-tab",
      ]),
    };
    const stableIdentity = {
      ...identity,
      preferenceScope: makeCanvasViewportPreferenceScope({
        variant: "stage",
        windowSessionId: "window-1",
        projectSessionId: "session-1",
      }),
    };
    writeCanvasViewportPreference(legacyIdentity, {
      scrollX: -320,
      scrollY: 180,
      zoom: 1.75,
    });

    expect(readCanvasViewportPreference(stableIdentity)).toEqual({
      scrollX: -320,
      scrollY: 180,
      zoom: 1.75,
    });
    expect(localStorage.getItem(
      getCanvasViewportPreferenceStorageKey(stableIdentity)!,
    )).not.toBeNull();
  });

  test("migrates the v2 Stage viewport without admitting legacy inline scopes", () => {
    const stableIdentity = {
      ...identity,
      preferenceScope: makeCanvasViewportPreferenceScope({
        variant: "stage",
        windowSessionId: "window-1",
        projectSessionId: "session-1",
      }),
    };
    const value = JSON.stringify({
      version: 1,
      scrollX: 240,
      scrollY: -90,
      zoom: 2,
    });
    const legacyKeyPrefix = `nodex-canvas-viewport-v2:${
      encodeURIComponent(identity.storeEpoch)
    }:${encodeURIComponent(identity.documentId)}:`;
    localStorage.setItem(
      `${legacyKeyPrefix}${
        encodeURIComponent(JSON.stringify([
          "window-1",
          "session-1",
          "closed-tab",
        ]))
      }`,
      value,
    );

    expect(readCanvasViewportPreference(stableIdentity)).toEqual({
      scrollX: 240,
      scrollY: -90,
      zoom: 2,
    });

    localStorage.clear();
    localStorage.setItem(
      `${legacyKeyPrefix}${
        encodeURIComponent(JSON.stringify([
          "inline",
          "page-client-1",
          "canvas-1",
        ]))
      }`,
      value,
    );
    expect(readCanvasViewportPreference(stableIdentity)).toBeNull();
  });

  test("rejects corrupt, non-finite, and out-of-range viewport values", () => {
    expect(normalizeCanvasViewportPreference({
      scrollX: Number.NaN,
      scrollY: 0,
      zoom: 1,
    })).toBeNull();
    expect(normalizeCanvasViewportPreference({
      scrollX: 0,
      scrollY: Number.POSITIVE_INFINITY,
      zoom: 1,
    })).toBeNull();
    expect(normalizeCanvasViewportPreference({
      scrollX: 0,
      scrollY: 0,
      zoom: 0.09,
    })).toBeNull();
    expect(normalizeCanvasViewportPreference({
      scrollX: 0,
      scrollY: 0,
      zoom: 30.01,
    })).toBeNull();

    const storageKey = getCanvasViewportPreferenceStorageKey(identity);
    expect(storageKey).not.toBeNull();
    localStorage.setItem(storageKey!, "{broken");
    expect(readCanvasViewportPreference(identity)).toBeNull();
  });

  test("persists only the latest viewport after the 300 ms debounce", () => {
    vi.useFakeTimers();
    const persistence = createCanvasViewportPersistence(identity);
    persistence.observe({ scrollX: 1, scrollY: 2, zoom: 1 });
    persistence.observe({ scrollX: 3, scrollY: 4, zoom: 2 });

    vi.advanceTimersByTime(299);
    expect(readCanvasViewportPreference(identity)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(readCanvasViewportPreference(identity)).toEqual({
      scrollX: 3,
      scrollY: 4,
      zoom: 2,
    });

    persistence.observe({ scrollX: 5, scrollY: 6, zoom: 3 });
    persistence.dispose();
    expect(readCanvasViewportPreference(identity)).toEqual({
      scrollX: 5,
      scrollY: 6,
      zoom: 3,
    });
  });

  test("degrades silently when renderer storage is unavailable", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("unavailable");
      },
    };

    expect(readCanvasViewportPreference(identity, unavailable)).toBeNull();
    expect(() => writeCanvasViewportPreference(
      identity,
      { scrollX: 0, scrollY: 0, zoom: 1 },
      unavailable,
    )).not.toThrow();
  });
});

describe("Canvas inline frame preference", () => {
  const frameIdentity = {
    storeEpoch: "epoch:test",
    canvasBlockId: "canvas-1",
  };

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("round-trips a Store-local Canvas frame height", () => {
    writeCanvasInlineFramePreference(frameIdentity, { heightPx: 520 });
    expect(readCanvasInlineFramePreference(frameIdentity)).toEqual({
      heightPx: 520,
    });
    expect(readCanvasInlineFramePreference({
      ...frameIdentity,
      storeEpoch: "epoch:other",
    })).toBeNull();
    expect(readCanvasInlineFramePreference({
      ...frameIdentity,
      canvasBlockId: "canvas-2",
    })).toBeNull();
  });

  test("normalizes finite heights into the supported frame range", () => {
    expect(normalizeCanvasInlineFramePreference({
      heightPx: MIN_CANVAS_INLINE_FRAME_HEIGHT_PX - 100,
    })).toEqual({ heightPx: MIN_CANVAS_INLINE_FRAME_HEIGHT_PX });
    expect(normalizeCanvasInlineFramePreference({
      heightPx: MAX_CANVAS_INLINE_FRAME_HEIGHT_PX + 100,
    })).toEqual({ heightPx: MAX_CANVAS_INLINE_FRAME_HEIGHT_PX });
    expect(normalizeCanvasInlineFramePreference({ heightPx: 520.6 }))
      .toEqual({ heightPx: 521 });
    expect(normalizeCanvasInlineFramePreference({ heightPx: Number.NaN }))
      .toBeNull();
    expect(normalizeCanvasInlineFramePreference({
      heightPx: Number.POSITIVE_INFINITY,
    })).toBeNull();
    expect(DEFAULT_CANVAS_INLINE_FRAME_HEIGHT_PX).toBe(288);
  });

  test("persists the latest frame height and flushes on dispose", () => {
    vi.useFakeTimers();
    const persistence = createCanvasInlineFramePersistence(frameIdentity);
    persistence.observe({ heightPx: 400 });
    persistence.observe({ heightPx: 520 });
    vi.advanceTimersByTime(299);
    expect(readCanvasInlineFramePreference(frameIdentity)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(readCanvasInlineFramePreference(frameIdentity)).toEqual({
      heightPx: 520,
    });

    persistence.observe({ heightPx: 640 });
    persistence.dispose();
    expect(readCanvasInlineFramePreference(frameIdentity)).toEqual({
      heightPx: 640,
    });
  });

  test("rejects corrupt storage and builds stable semantic scopes", () => {
    const key = getCanvasInlineFramePreferenceStorageKey(frameIdentity);
    expect(key).not.toBeNull();
    localStorage.setItem(key!, "{broken");
    expect(readCanvasInlineFramePreference(frameIdentity)).toBeNull();

    expect(makeCanvasViewportPreferenceScope({
      variant: "inline",
      canvasBlockId: "canvas-1",
    })).toBe(makeCanvasViewportPreferenceScope({
      variant: "inline",
      canvasBlockId: "canvas-1",
    }));
    const stageScope = makeCanvasViewportPreferenceScope({
      variant: "stage",
      windowSessionId: "window-1",
      projectSessionId: "session-1",
    });
    expect(stageScope).toBe(JSON.stringify([
      "stage",
      "window-1",
      "session-1",
    ]));
    expect(makeCanvasViewportPreferenceScope({
      variant: "stage",
      windowSessionId: "window-2",
      projectSessionId: "session-1",
    })).not.toBe(stageScope);
    expect(makeCanvasViewportPreferenceScope({
      variant: "stage",
      windowSessionId: "window-1",
      projectSessionId: "session-2",
    })).not.toBe(stageScope);
  });
});
