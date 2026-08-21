import { describe, expect, test } from "vitest";
import {
  collectTurnDiffChangedPaths,
  filterTurnDiffPayload,
  isResourceInsideProjectlessOutputDirectory,
  normalizeTurnDiffPatchBatches,
  shouldSuppressTurnDiffByEndResources,
} from "./projectless-output-scope";

const MIXED_DIFF = [
  "diff --git a/output/inside.ts b/output/inside.ts",
  "--- a/output/inside.ts",
  "+++ b/output/inside.ts",
  "@@ -1 +1 @@",
  "-before",
  "+after",
  "diff --git a/output-other/outside.ts b/output-other/outside.ts",
  "--- a/output-other/outside.ts",
  "+++ b/output-other/outside.ts",
  "@@ -1 +1 @@",
  "-before",
  "+after",
].join("\n");

describe("projectless output scope", () => {
  test("uses root-or-descendant matching instead of a string prefix", () => {
    const scope = {
      cwd: "/workspace",
      projectlessOutputDirectory: "output",
    };

    expect(
      isResourceInsideProjectlessOutputDirectory({
        ...scope,
        resourcePath: "output/file.ts",
      }),
    ).toBe(true);
    expect(
      isResourceInsideProjectlessOutputDirectory({
        ...scope,
        resourcePath: "output",
      }),
    ).toBe(true);
    expect(
      isResourceInsideProjectlessOutputDirectory({
        ...scope,
        resourcePath: "output-other/file.ts",
      }),
    ).toBe(false);
    expect(
      isResourceInsideProjectlessOutputDirectory({
        ...scope,
        resourcePath: "../output-other/file.ts",
      }),
    ).toBe(false);
  });

  test("filters unified diff blocks and keeps only projectless outputs", () => {
    const filtered = filterTurnDiffPayload(
      { unifiedDiff: MIXED_DIFF },
      {
        cwd: "/workspace",
        projectlessOutputDirectory: "/workspace/output",
      },
    );

    expect(filtered?.unifiedDiff).toContain("output/inside.ts");
    expect(filtered?.unifiedDiff).not.toContain("output-other/outside.ts");
    expect(
      collectTurnDiffChangedPaths(filtered ?? { unifiedDiff: "" }, {
        cwd: "/workspace",
        projectlessOutputDirectory: "/workspace/output",
      }),
    ).toEqual(["/workspace/output/inside.ts"]);
  });

  test("preserves a non-empty unscoped stale payload for Review empty-state handling", () => {
    const payload = filterTurnDiffPayload(
      {
        unifiedDiff: "diff payload retained but no renderable file entries",
      },
      {},
    );

    expect(payload?.unifiedDiff).toBe("diff payload retained but no renderable file entries");
  });

  test("supports patch-batch-only payloads and scopes apply data", () => {
    const filtered = filterTurnDiffPayload(
      {
        unifiedDiff: "",
        patchBatches: [
          {
            cwd: "/workspace",
            changes: [
              { path: "output/inside.ts", type: "add", content: "inside" },
              { path: "output-other/outside.ts", type: "add", content: "outside" },
            ],
          },
        ],
      },
      {
        cwd: "/workspace",
        projectlessOutputDirectory: "/workspace/output",
      },
    );

    expect(filtered?.unifiedDiff).toContain("output/inside.ts");
    expect(filtered?.unifiedDiff).not.toContain("output-other/outside.ts");
    expect(filtered?.patchBatches?.[0]?.changes).toHaveLength(1);
  });

  test("normalizes malformed patch-batch envelopes at the shared boundary", () => {
    const batches = normalizeTurnDiffPatchBatches([
      null,
      { cwd: 42, changes: "not-an-array" },
      { cwd: "/workspace", changes: [{ path: "output/file.ts", type: "add" }] },
    ]);

    expect(batches).toEqual([
      { cwd: null, changes: [] },
      { cwd: "/workspace", changes: [{ path: "output/file.ts", type: "add" }] },
    ]);
  });

  test("suppresses a turn card only when every changed path is an end resource", () => {
    const payload = filterTurnDiffPayload(
      { unifiedDiff: MIXED_DIFF },
      {
        cwd: "/workspace",
        projectlessOutputDirectory: "/workspace/output",
      },
    );
    if (!payload) throw new Error("Expected a scoped diff");

    expect(
      shouldSuppressTurnDiffByEndResources({
        payload,
        endResourcePaths: ["/workspace/output/inside.ts"],
        scope: { cwd: "/workspace", projectlessOutputDirectory: "/workspace/output" },
      }),
    ).toBe(true);
    expect(
      shouldSuppressTurnDiffByEndResources({
        payload,
        endResourcePaths: [],
        scope: { cwd: "/workspace", projectlessOutputDirectory: "/workspace/output" },
      }),
    ).toBe(false);
  });
});
