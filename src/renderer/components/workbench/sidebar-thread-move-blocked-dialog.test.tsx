import { describe, expect, test } from "vitest";
import { formatMissingProjectSourceList } from "./sidebar-thread-move-blocked-dialog";

describe("SidebarThreadMoveBlockedDialog", () => {
  test("formats one and many missing source paths as an English conjunction", () => {
    expect(formatMissingProjectSourceList(["/repo/alpha"])).toBe("/repo/alpha");
    expect(formatMissingProjectSourceList(["/repo/alpha", "/repo/beta"]))
      .toBe("/repo/alpha and /repo/beta");
    expect(formatMissingProjectSourceList(["/repo/alpha", "/repo/beta", "/repo/gamma"]))
      .toBe("/repo/alpha, /repo/beta, and /repo/gamma");
  });
});

