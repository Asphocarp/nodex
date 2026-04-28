import { describe, expect, test } from "bun:test";
import { createNfmSerializedChangeEmitter } from "./nfm-serialized-change-emitter";

describe("nfm serialized change emitter", () => {
  test("marks the first edit dirty without serializing synchronously", () => {
    let serializeCount = 0;
    let lastEmitted = "base";
    const emitted: string[] = [];
    const timers: Array<() => void> = [];

    const emitter = createNfmSerializedChangeEmitter<number>({
      debounceMs: 250,
      serialize: () => {
        serializeCount += 1;
        return "next";
      },
      emit: (value) => emitted.push(value),
      getLastEmitted: () => lastEmitted,
      setLastEmitted: (value) => {
        lastEmitted = value;
      },
      setTimer: (callback) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimer: () => undefined,
    });

    emitter.schedule();

    expect(emitter.hasPendingChange()).toBeTrue();
    expect(serializeCount).toBe(0);
    expect(emitted.length).toBe(0);
  });

  test("coalesces rapid edits into one serialized emit", () => {
    let lastEmitted = "base";
    let nextSerialized = "first";
    const emitted: string[] = [];
    const cancelled = new Set<number>();
    const timers = new Map<number, () => void>();
    let nextTimerId = 1;

    const emitter = createNfmSerializedChangeEmitter<number>({
      debounceMs: 250,
      serialize: () => nextSerialized,
      emit: (value) => emitted.push(value),
      getLastEmitted: () => lastEmitted,
      setLastEmitted: (value) => {
        lastEmitted = value;
      },
      setTimer: (callback) => {
        const id = nextTimerId;
        nextTimerId += 1;
        timers.set(id, callback);
        return id;
      },
      clearTimer: (timer) => {
        cancelled.add(timer);
      },
    });

    emitter.schedule();
    nextSerialized = "second";
    emitter.schedule();

    const firstTimer = timers.get(1);
    const secondTimer = timers.get(2);
    if (!cancelled.has(1)) firstTimer?.();
    if (!cancelled.has(2)) secondTimer?.();

    expect(emitted.length).toBe(1);
    expect(emitted[0]).toBe("second");
    expect(emitter.hasPendingChange()).toBeFalse();
  });

  test("explicit flush serializes immediately and clears the pending timer", () => {
    let lastEmitted = "base";
    let clearedTimer = 0;
    const emitted: string[] = [];

    const emitter = createNfmSerializedChangeEmitter<number>({
      debounceMs: 250,
      serialize: () => "flushed",
      emit: (value) => emitted.push(value),
      getLastEmitted: () => lastEmitted,
      setLastEmitted: (value) => {
        lastEmitted = value;
      },
      setTimer: () => 7,
      clearTimer: (timer) => {
        clearedTimer = timer;
      },
    });

    emitter.schedule();
    const flushed = emitter.flush();

    expect(flushed).toBe("flushed");
    expect(clearedTimer).toBe(7);
    expect(emitted[0]).toBe("flushed");
    expect(emitter.hasPendingChange()).toBeFalse();
  });

  test("does not emit when serialized output is unchanged", () => {
    let lastEmitted = "same";
    const emitted: string[] = [];
    const timers: Array<() => void> = [];

    const emitter = createNfmSerializedChangeEmitter<number>({
      debounceMs: 250,
      serialize: () => "same",
      emit: (value) => emitted.push(value),
      getLastEmitted: () => lastEmitted,
      setLastEmitted: (value) => {
        lastEmitted = value;
      },
      setTimer: (callback) => {
        timers.push(callback);
        return 1;
      },
      clearTimer: () => undefined,
    });

    emitter.schedule();
    timers[0]?.();

    expect(emitted.length).toBe(0);
    expect(lastEmitted).toBe("same");
  });

  test("cancel drops suppressed changes before serialization", () => {
    let serializeCount = 0;
    let lastEmitted = "base";
    const emitted: string[] = [];

    const emitter = createNfmSerializedChangeEmitter<number>({
      debounceMs: 250,
      serialize: () => {
        serializeCount += 1;
        return "suppressed";
      },
      emit: (value) => emitted.push(value),
      getLastEmitted: () => lastEmitted,
      setLastEmitted: (value) => {
        lastEmitted = value;
      },
      setTimer: () => 1,
      clearTimer: () => undefined,
    });

    emitter.schedule();
    emitter.cancel();
    const flushed = emitter.flush();

    expect(flushed).toBe(null);
    expect(serializeCount).toBe(0);
    expect(emitted.length).toBe(0);
  });
});
