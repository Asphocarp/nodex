import { describe, expect, test } from "vitest";
import {
  dedupeSourceRoots,
  makeSourceRootPrimary,
  normalizeSourceRootKey,
  sourceRootDisplayName,
} from "./project-sources";

describe("normalizeSourceRootKey", () => {
  test("lowercases and normalizes slashes", () => {
    expect(normalizeSourceRootKey("/Users/ASC/Repo")).toBe("/users/asc/repo");
    expect(normalizeSourceRootKey("C:\\Repo\\App")).toBe("c:/repo/app");
  });

  test("strips Windows long-path prefixes", () => {
    expect(normalizeSourceRootKey("\\\\?\\C:\\Repo")).toBe("c:/repo");
    expect(normalizeSourceRootKey("\\\\?\\UNC\\server\\share")).toBe("//server/share");
  });
});

describe("dedupeSourceRoots", () => {
  test("keeps first occurrence and drops case-insensitive duplicates", () => {
    expect(dedupeSourceRoots(["/repo/a", "/Repo/A", "/repo/b"])).toEqual(["/repo/a", "/repo/b"]);
  });

  test("treats backslash and forward-slash paths as the same folder", () => {
    expect(dedupeSourceRoots(["C:/repo", "C:\\repo"])).toEqual(["C:/repo"]);
  });

  test("drops empty and whitespace-only entries and trims the rest", () => {
    expect(dedupeSourceRoots(["", "  ", " /repo/a "])).toEqual(["/repo/a"]);
  });

  test("preserves order of distinct roots", () => {
    expect(dedupeSourceRoots(["/b", "/a", "/c"])).toEqual(["/b", "/a", "/c"]);
  });
});

describe("sourceRootDisplayName", () => {
  test("returns the last path segment", () => {
    expect(sourceRootDisplayName("/Users/asc/repo/nodex")).toBe("nodex");
    expect(sourceRootDisplayName("C:\\repo\\app")).toBe("app");
  });

  test("ignores trailing slashes", () => {
    expect(sourceRootDisplayName("/repo/nodex/")).toBe("nodex");
    expect(sourceRootDisplayName("/repo/nodex///")).toBe("nodex");
  });

  test("falls back to the normalized path for the filesystem root", () => {
    expect(sourceRootDisplayName("/")).toBe("/");
  });
});

describe("makeSourceRootPrimary", () => {
  test("moves the root to the front and keeps relative order", () => {
    expect(makeSourceRootPrimary(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"]);
  });

  test("keeps an already-primary root stable", () => {
    expect(makeSourceRootPrimary(["/a", "/b"], "/a")).toEqual(["/a", "/b"]);
  });
});
