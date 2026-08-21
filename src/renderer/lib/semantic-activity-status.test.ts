import { describe, expect, test } from "vite-plus/test";

import {
  semanticActivitySummaryClassName,
  semanticActivityStatusFromLifecycle,
  semanticActivityTextClassName,
} from "./semantic-activity-status";

describe("semantic activity status", () => {
  test("maps lifecycle states to stable visual roles", () => {
    expect(semanticActivityTextClassName("failed")).toBe("text-danger");
    expect(semanticActivityTextClassName("pending")).toBe("text-tertiary");
    expect(semanticActivityTextClassName("running")).toBe("text-info");
    expect(semanticActivityTextClassName("completed")).toBe("text-info");
    expect(semanticActivitySummaryClassName("completed")).toContain("semantic-text-secondary");
    expect(semanticActivityStatusFromLifecycle("inProgress", "completed")).toBe("running");
    expect(semanticActivityStatusFromLifecycle("streaming", "completed")).toBe("running");
    expect(semanticActivityStatusFromLifecycle("failed", "completed")).toBe("failed");
    expect(semanticActivityStatusFromLifecycle("rejected", "completed")).toBe("failed");
    expect(semanticActivityStatusFromLifecycle("applied", "failed")).toBe("completed");
    expect(semanticActivityStatusFromLifecycle("interrupted", "completed")).toBe("skipped");
    expect(semanticActivityStatusFromLifecycle(undefined, "running")).toBe("running");
  });
});
