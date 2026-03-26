import { describe, expect, test } from "bun:test";
import {
  parseCodexSessionIndexEntryLine,
  parseCodexSessionJsonlLine,
} from "./codex-session";

describe("codex-session schemas", () => {
  test("parses session index lines with codex field aliases", () => {
    const entry = parseCodexSessionIndexEntryLine(JSON.stringify({
      id: "thr_1",
      thread_name: "Imported thread",
      updated_at: "2026-03-17T10:03:00.000Z",
    }));

    expect(JSON.stringify(entry)).toBe(JSON.stringify({
      id: "thr_1",
      threadName: "Imported thread",
      updatedAt: Date.parse("2026-03-17T10:03:00.000Z"),
    }));
  });

  test("parses jsonl session lines and falls back when payload is not an object", () => {
    const line = parseCodexSessionJsonlLine(JSON.stringify({
      timestamp: "not-a-date",
      type: "event_msg",
      payload: ["bad"],
    }), 123);

    expect(JSON.stringify(line)).toBe(JSON.stringify({
      timestamp: 123,
      type: "event_msg",
      payload: null,
    }));
  });
});
