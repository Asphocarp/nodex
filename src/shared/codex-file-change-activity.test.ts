import { describe, expect, test } from "vitest";
import { resolveCodexFileChangeActivity } from "./codex-file-change-activity";

describe("resolveCodexFileChangeActivity", () => {
  test("keeps an empty in-progress file change active", () => {
    const activity = resolveCodexFileChangeActivity({
      status: "inProgress",
      fileChange: { changes: {} },
    });

    expect(activity).toMatchObject({
      visibility: "active",
      lifecycle: "inProgress",
      success: null,
      hasMaterializedChanges: false,
      canExpandBody: false,
      displayPaths: [],
    });
  });

  test("suppresses empty terminal rows but keeps materialized rows", () => {
    expect(resolveCodexFileChangeActivity({
      status: "completed",
      fileChange: { changes: {} },
    }).visibility).toBe("suppressed");

    expect(resolveCodexFileChangeActivity({
      status: "completed",
      fileChange: {
        changes: {
          "src/app.ts": {
            type: "update",
            unifiedDiff: "@@ -1 +1 @@",
            movePath: null,
          },
        },
      },
    }).visibility).toBe("terminal");
  });
});
