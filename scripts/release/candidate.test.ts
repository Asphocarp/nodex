import { describe, expect, test } from "vitest";
import { assertSameReleaseIdentity, createReleaseIdentity } from "./candidate";

describe("release candidate identity", () => {
  test("derives one deterministic nightly identity from source facts", () => {
    const facts = {
      channel: "nightly" as const,
      sourceSha: "a".repeat(40),
      sourceTree: "b".repeat(40),
      sourceVersion: "0.2.1",
      sourceDate: "2026-08-13",
      mainlineOrdinal: 842,
    };
    expect(createReleaseIdentity(facts)).toEqual(createReleaseIdentity(facts));
    expect(createReleaseIdentity(facts)).toMatchObject({
      version: "0.2.2-nightly.20260813.842",
      buildVersion: "1.8.42",
      tag: "v0.2.2-nightly.20260813.842",
    });
  });

  test("rejects an identity that is not the exact expected source identity", () => {
    const expected = createReleaseIdentity({
      channel: "nightly",
      sourceSha: "a".repeat(40),
      sourceTree: "b".repeat(40),
      sourceVersion: "0.2.1",
      sourceDate: "2026-08-13",
      mainlineOrdinal: 842,
    });
    const other = createReleaseIdentity({
      ...expected,
      sourceSha: "c".repeat(40),
    });
    expect(() => assertSameReleaseIdentity(expected, other)).toThrow("exact source ref");
  });
});
