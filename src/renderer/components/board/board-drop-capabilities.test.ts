import { describe, expect, test } from "vitest";
import { resolveBoardDropCapabilities } from "./board-drop-capabilities";

describe("resolveBoardDropCapabilities", () => {
  test("keeps both card and column targets active under the default board sort", () => {
    const capabilities = resolveBoardDropCapabilities({
      dragMode: { kind: "manual-rank" },
    });

    expect(capabilities.allowPageTargets).toBe(true);
    expect(capabilities.allowColumnTargets).toBe(true);
  });

  test("keeps card targets active for inferable property-sorted drags", () => {
    const capabilities = resolveBoardDropCapabilities({
      dragMode: { kind: "property-sorted", field: "priority" },
    });

    expect(capabilities.allowPageTargets).toBe(true);
    expect(capabilities.allowColumnTargets).toBe(true);
  });

  test("disables only card targets under move-only derived sorts so cross-column drops still resolve", () => {
    const capabilities = resolveBoardDropCapabilities({
      dragMode: { kind: "derived-move-only", field: "title" },
    });

    expect(capabilities.allowPageTargets).toBe(false);
    expect(capabilities.allowColumnTargets).toBe(true);
  });
});
