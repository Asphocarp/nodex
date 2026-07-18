import { describe, expect, test } from "vitest";

import { SseParser } from "./sse-parser";

describe("SseParser", () => {
  test("reconstructs fragmented UTF-8 frames and multiline data", () => {
    const parser = new SseParser(4_096);
    const bytes = new TextEncoder().encode(
      ": keep-alive\r\nevent: module\r\nid: 7\r\ndata: {\"title\":\"中😀\"}\r\n\r\n" +
        "event: notice\ndata: first\ndata: second\n\n",
    );
    const events = Array.from(bytes).flatMap((byte) =>
      parser.push(Uint8Array.of(byte)),
    );

    expect(events).toEqual([
      { event: "module", id: "7", data: '{"title":"中😀"}' },
      { event: "notice", id: "", data: "first\nsecond" },
    ]);
    expect(parser.finish()).toEqual([]);
  });

  test("rejects a frame that grows past the configured bound", () => {
    const parser = new SseParser(8);
    expect(() => parser.push(new TextEncoder().encode("data: too large"))).toThrow(
      "SSE frame exceeds 8 buffered bytes",
    );
  });
});
