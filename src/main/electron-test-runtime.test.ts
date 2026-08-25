import { describe, expect, test } from "vite-plus/test";

describe("main test runtime", () => {
  test("uses the pinned Electron and Node runtimes", () => {
    expect(process.versions.electron).toBe("43.4.1");
    expect(process.versions.node).toBe("24.18.1");
    expect(process.versions.modules).toBe("148");
  });
});
