import { describe, expect, test } from "vitest";
import {
  buildVersionForMainlineOrdinal,
  compareBuildVersions,
  latestStableAppVersion,
  nightlyVersionFor,
  parseReleaseIdentity,
} from "./model";

const sha = "a".repeat(40);
const tree = "b".repeat(40);

describe("release versions", () => {
  test("latest stable app version ignores Browser runtime and malformed tags", () => {
    expect(
      latestStableAppVersion([
        "browser-runtime-v26.727.40816",
        "v0.1.10",
        "v0.2.0-beta.1",
        "not-a-release",
        "v0.2.0",
      ]),
    ).toBe("0.2.0");
  });

  test("nightly display version advances the source patch deterministically", () => {
    expect(nightlyVersionFor("0.2.1", "2026-08-13", 842)).toBe("0.2.2-nightly.20260813.842");
  });

  test.each([
    [842, "1.8.42"],
    [9_999, "1.99.99"],
    [10_000, "2.0.0"],
  ])("encodes mainline ordinal %i as monotonic Apple build version %s", (ordinal, expected) => {
    expect(buildVersionForMainlineOrdinal(ordinal)).toBe(expected);
  });

  test("compares Apple build versions numerically", () => {
    expect(compareBuildVersions("1.99.99", "2.0.0")).toBe(-1);
    expect(compareBuildVersions("2.0.1", "2.0.0")).toBe(1);
    expect(compareBuildVersions("2.0.0", "2.0.0")).toBe(0);
  });
});

describe("Release Identity", () => {
  test("accepts a coherent nightly identity", () => {
    expect(
      parseReleaseIdentity({
        schemaVersion: 1,
        channel: "nightly",
        sourceSha: sha,
        sourceTree: tree,
        sourceVersion: "0.2.1",
        version: "0.2.2-nightly.20260813.842",
        buildVersion: "1.8.42",
        tag: "v0.2.2-nightly.20260813.842",
        mainlineOrdinal: 842,
        sourceDate: "2026-08-13",
      }),
    ).toMatchObject({ channel: "nightly", version: "0.2.2-nightly.20260813.842" });
  });

  test("accepts a coherent stable identity", () => {
    expect(
      parseReleaseIdentity({
        schemaVersion: 1,
        channel: "stable",
        sourceSha: sha,
        sourceTree: tree,
        sourceVersion: "0.2.1",
        version: "0.2.1",
        buildVersion: "1.8.42",
        tag: "v0.2.1",
        mainlineOrdinal: 842,
        sourceDate: "2026-08-13",
      }),
    ).toMatchObject({ channel: "stable", version: "0.2.1" });
  });

  test.each([
    ["version", "0.2.2-nightly.20260813.841"],
    ["buildVersion", "1.8.41"],
    ["tag", "v0.2.2-nightly.20260813.841"],
    ["sourceDate", "2026-02-30"],
  ])("rejects an incoherent %s", (key, value) => {
    expect(() =>
      parseReleaseIdentity({
        schemaVersion: 1,
        channel: "nightly",
        sourceSha: sha,
        sourceTree: tree,
        sourceVersion: "0.2.1",
        version: "0.2.2-nightly.20260813.842",
        buildVersion: "1.8.42",
        tag: "v0.2.2-nightly.20260813.842",
        mainlineOrdinal: 842,
        sourceDate: "2026-08-13",
        [key]: value,
      }),
    ).toThrow();
  });

  test("rejects unknown keys instead of silently accepting schema drift", () => {
    expect(() =>
      parseReleaseIdentity({
        schemaVersion: 1,
        channel: "stable",
        sourceSha: sha,
        sourceTree: tree,
        sourceVersion: "0.2.1",
        version: "0.2.1",
        buildVersion: "1.8.42",
        tag: "v0.2.1",
        mainlineOrdinal: 842,
        sourceDate: "2026-08-13",
        extra: true,
      }),
    ).toThrow(/exactly/);
  });
});
