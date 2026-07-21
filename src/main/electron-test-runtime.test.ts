import { describe, expect, test } from "vitest";

describe("main test runtime", () => {
  test("uses the pinned Electron and Node runtimes", () => {
    expect(process.versions.electron).toBe("40.10.4");
    expect(process.versions.node).toBe("24.15.0");
  });
});
