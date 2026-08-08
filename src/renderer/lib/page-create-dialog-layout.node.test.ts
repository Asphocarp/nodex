import { describe, expect, test } from "vitest";
import { resolvePageCreateDialogLayout } from "./page-create-dialog-layout";

describe("Page create dialog layout", () => {
  test("keeps compact and expanded states in distinct, upper-anchored size classes", () => {
    const compact = resolvePageCreateDialogLayout(false);
    const expanded = resolvePageCreateDialogLayout(true);

    expect(compact).toEqual({
      width: 750,
      topViewportPercent: 13,
      minimumWritingHeight: 79,
      fillsAvailableHeight: false,
    });
    expect(expanded.width).toBe(820);
    expect(expanded.topViewportPercent).toBeLessThan(compact.topViewportPercent);
    expect(expanded.minimumWritingHeight).toBeGreaterThan(compact.minimumWritingHeight);
    expect(expanded.fillsAvailableHeight).toBe(true);
  });
});
