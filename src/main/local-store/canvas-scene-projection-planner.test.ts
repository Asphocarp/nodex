import { describe, expect, test } from "bun:test";
import { planCanvasSceneFileProjections } from "./block-document-projections";

describe("Canvas scene asset projection planner", () => {
  test("reuses immutable evidence and reads only new or changed refs", () => {
    const plans = planCanvasSceneFileProjections(
      {
        unchanged: {
          id: "unchanged",
          mimeType: "image/png",
          source: "nodex://assets/unchanged.png",
        },
        changed: {
          id: "changed",
          mimeType: "image/webp",
          source: "nodex://assets/changed-v2.webp",
        },
        added: {
          id: "added",
          mimeType: "image/png",
          source: "nodex://assets/added.png",
        },
      },
      [
        {
          file_id: "unchanged",
          asset_uri: "nodex://assets/unchanged.png",
          managed_file_name: "unchanged.png",
          asset_hash: "a".repeat(64),
          byte_length: 42,
        },
        {
          file_id: "changed",
          asset_uri: "nodex://assets/changed-v1.webp",
          managed_file_name: "changed-v1.webp",
          asset_hash: "b".repeat(64),
          byte_length: 51,
        },
      ],
    );
    const unchanged = plans.find((plan) => plan.fileId === "unchanged");
    const changed = plans.find((plan) => plan.fileId === "changed");
    const added = plans.find((plan) => plan.fileId === "added");
    expect(unchanged?.requiresAssetRead).toBeFalse();
    expect(unchanged?.reusableAssetHash).toBe("a".repeat(64));
    expect(unchanged?.reusableByteLength).toBe(42);
    expect(changed?.requiresAssetRead).toBeTrue();
    expect(added?.requiresAssetRead).toBeTrue();
  });
});
