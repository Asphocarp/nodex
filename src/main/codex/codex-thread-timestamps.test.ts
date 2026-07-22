import { describe, expect, test } from "vitest";
import {
  readCodexThreadUuidV7TimestampMs,
  reconcileCodexThreadTimestamps,
} from "./codex-thread-timestamps";

describe("Codex Thread timestamp reconciliation", () => {
  test("reads the canonical creation instant from a UUIDv7 Thread id", () => {
    const threadId = "019f2321-8ed9-74d0-a2cc-48856e20cf0c";

    expect(readCodexThreadUuidV7TimestampMs(threadId)).toBe(1_783_000_829_657);
    expect(readCodexThreadUuidV7TimestampMs("thread-custom")).toBeNull();
  });

  test("repairs a historical UTC+8 created timestamp from UUIDv7 evidence", () => {
    expect(reconcileCodexThreadTimestamps({
      threadId: "019f2321-8ed9-74d0-a2cc-48856e20cf0c",
      observedCreatedAt: 1_783_029_629,
      observedUpdatedAt: 1_783_000_989,
      existing: null,
    })).toEqual({
      createdAt: 1_783_000_829_000,
      updatedAt: 1_783_000_989_000,
    });
  });

  test("uses UUIDv7 creation evidence instead of a later live recency observation", () => {
    expect(reconcileCodexThreadTimestamps({
      threadId: "019f8b12-45fe-7e53-a8ba-bd0c0d5b4e88",
      observedCreatedAt: 1_784_744_661,
      observedUpdatedAt: 1_784_744_712,
      existing: null,
    })).toEqual({
      createdAt: 1_784_744_658_000,
      updatedAt: 1_784_744_712_000,
    });
  });

  test("keeps an existing durable Thread clock monotonic across stale observations", () => {
    expect(reconcileCodexThreadTimestamps({
      threadId: "thread-custom",
      observedCreatedAt: 20,
      observedUpdatedAt: 30,
      existing: {
        createdAt: 10_000,
        updatedAt: 40_000,
      },
    })).toEqual({
      createdAt: 10_000,
      updatedAt: 40_000,
    });
  });

  test("uses one safe boundary when a custom Thread reports an inverted pair", () => {
    expect(reconcileCodexThreadTimestamps({
      threadId: "thread-custom",
      observedCreatedAt: 20,
      observedUpdatedAt: 10,
      existing: null,
    })).toEqual({
      createdAt: 10_000,
      updatedAt: 10_000,
    });
  });
});
