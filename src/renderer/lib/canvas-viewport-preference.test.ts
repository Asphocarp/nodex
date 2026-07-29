import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createCanvasViewportPersistence,
  getCanvasViewportPreferenceStorageKey,
  normalizeCanvasViewportPreference,
  readCanvasViewportPreference,
  writeCanvasViewportPreference,
} from "./canvas-viewport-preference";

const identity = {
  storeEpoch: "epoch:test",
  documentId: "document:canvas",
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
