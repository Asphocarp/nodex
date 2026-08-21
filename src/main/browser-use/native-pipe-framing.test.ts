import { endianness } from "node:os";
import { describe, expect, test } from "vitest";
import {
  BrowserUseNativePipeFrameDecoder,
  encodeBrowserUseNativePipeFrame,
} from "./native-pipe-framing";

describe("Browser Use native-pipe framing", () => {
  test("decodes split headers, split payloads, and coalesced frames", () => {
    const first = encodeBrowserUseNativePipeFrame(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    );
    const second = encodeBrowserUseNativePipeFrame(
      JSON.stringify({ jsonrpc: "2.0", id: "two", method: "getInfo" }),
    );
    const decoder = new BrowserUseNativePipeFrameDecoder();

    expect(decoder.push(first.subarray(0, 2))).toEqual([]);
    expect(decoder.push(first.subarray(2, 7))).toEqual([]);
    expect(decoder.push(Buffer.concat([first.subarray(7), second]))).toEqual([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", id: "two", method: "getInfo" }),
    ]);
  });

  test("rejects oversized outgoing and incoming frames", () => {
    expect(() => encodeBrowserUseNativePipeFrame("12345", 4)).toThrow("exceeds 4 bytes");

    const oversizedHeader = Buffer.alloc(4);
    if (endianness() === "LE") {
      oversizedHeader.writeUInt32LE(5);
    } else {
      oversizedHeader.writeUInt32BE(5);
    }
    const decoder = new BrowserUseNativePipeFrameDecoder(4);
    expect(() => decoder.push(oversizedHeader)).toThrow("exceeds 4 bytes");
  });

  test("accepts the maximum payload and preserves unicode", () => {
    const message = "你好 Browser";
    const encoded = encodeBrowserUseNativePipeFrame(message, Buffer.byteLength(message));
    const decoder = new BrowserUseNativePipeFrameDecoder(Buffer.byteLength(message));
    expect(decoder.push(encoded)).toEqual([message]);
  });
});
