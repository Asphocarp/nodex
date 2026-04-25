import { describe, expect, test } from "bun:test";
import {
  normalizeShiftWheelDelta,
  resolveShiftScrollBufferDays,
  resolveShiftScrollSettleDays,
  scaleShiftWheelDelta,
} from "./calendar-shift-scroll";

describe("normalizeShiftWheelDelta", () => {
  test("normalizes shift wheel deltas", () => {
    expect(normalizeShiftWheelDelta({
      shiftKey: false,
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
      pageHeight: 600,
    })).toBe(0);

    expect(normalizeShiftWheelDelta({
      shiftKey: true,
      deltaX: 40,
      deltaY: 120,
      deltaMode: 0,
      pageHeight: 600,
    })).toBe(40);

    expect(normalizeShiftWheelDelta({
      shiftKey: true,
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      pageHeight: 600,
    })).toBe(48);

    expect(normalizeShiftWheelDelta({
      shiftKey: true,
      deltaX: 0,
      deltaY: 1,
      deltaMode: 2,
      pageHeight: 600,
    })).toBe(600);
  });
});

describe("resolveShiftScrollSettleDays", () => {
  test("rounds accumulated wheel distance to any day count", () => {
    expect(resolveShiftScrollSettleDays(49, 100)).toBe(0);
    expect(resolveShiftScrollSettleDays(50, 100)).toBe(1);
    expect(resolveShiftScrollSettleDays(-50, 100)).toBe(-1);
    expect(resolveShiftScrollSettleDays(260, 100)).toBe(3);
    expect(resolveShiftScrollSettleDays(-260, 100)).toBe(-3);
  });
});

describe("scaleShiftWheelDelta", () => {
  test("reduces a raw wheel tick before accumulating visual offset", () => {
    expect(scaleShiftWheelDelta(100)).toBe(35);
    expect(scaleShiftWheelDelta(-100)).toBe(-35);
  });
});

describe("resolveShiftScrollBufferDays", () => {
  test("keeps enough visual day columns around the active range", () => {
    expect(resolveShiftScrollBufferDays(0, 100)).toBe(1);
    expect(resolveShiftScrollBufferDays(99, 100)).toBe(2);
    expect(resolveShiftScrollBufferDays(260, 100)).toBe(4);
    expect(resolveShiftScrollBufferDays(-260, 100)).toBe(4);
  });
});
