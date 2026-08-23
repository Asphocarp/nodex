import { describe, expect, test } from "vitest";
import { encodeDictationPcm16 } from "./dictation-pcm";

const readLittleEndianSamples = (buffer: ArrayBuffer): number[] => {
  const view = new DataView(buffer);
  return Array.from({ length: buffer.byteLength / 2 }, (_, index) =>
    view.getInt16(index * 2, true),
  );
};

describe("encodeDictationPcm16", () => {
  test("encodes a fixed frame as signed little-endian PCM with a bounded gain step", () => {
    const frame = encodeDictationPcm16(new Float32Array([0.5, -0.5, 1, -1]));

    expect(frame.gain).toBeCloseTo(0.6778913, 6);
    expect(readLittleEndianSamples(frame.pcm16)).toEqual([11106, -11107, 22212, -22213]);
  });

  test("does not amplify silence and preserves an empty frame", () => {
    const silence = encodeDictationPcm16(new Float32Array([0, 0.001]));
    expect(silence.gain).toBe(1);
    expect(readLittleEndianSamples(silence.pcm16)).toEqual([0, 33]);

    const empty = encodeDictationPcm16(new Float32Array(), 2);
    expect(empty.gain).toBeCloseTo(1.65, 8);
    expect(empty.pcm16.byteLength).toBe(0);
  });
});
