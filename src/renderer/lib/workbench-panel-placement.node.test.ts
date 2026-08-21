import { describe, expect, test } from "vitest";
import {
  insertWorkbenchPanelLeaf,
  makeWorkbenchPanelLayout,
} from "../../shared/workbench-panel-layout";
import { resolveRightNeighborPanelPlacement } from "./workbench-panel-placement";

describe("resolveRightNeighborPanelPlacement", () => {
  test("ensures a right group only for a single full-width source leaf", () => {
    const layout = makeWorkbenchPanelLayout(["db"], "db", "source");

    expect(
      resolveRightNeighborPanelPlacement(layout, "source", {
        fullWidth: true,
      }),
    ).toEqual({ kind: "ensure", sourceLeafId: "source" });
    expect(
      resolveRightNeighborPanelPlacement(layout, "source", {
        fullWidth: false,
      }),
    ).toEqual({ kind: "fallback" });
    expect(
      resolveRightNeighborPanelPlacement(layout, "missing", {
        fullWidth: true,
      }),
    ).toEqual({ kind: "fallback" });
  });

  test("reuses the nearest right group before considering a new split", () => {
    const layout = insertWorkbenchPanelLeaf(makeWorkbenchPanelLayout(["db"], "db", "source"), {
      leafId: "source",
      newLeafId: "target",
      newBranchId: "branch",
      side: "right",
    });

    expect(
      resolveRightNeighborPanelPlacement(layout, "source", {
        fullWidth: false,
      }),
    ).toEqual({ kind: "existing", leafId: "target" });
  });
});
