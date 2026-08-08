import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeTextToClipboard: vi.fn<(value: string) => Promise<boolean>>(),
  success: vi.fn(),
  danger: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  writeTextToClipboard: mocks.writeTextToClipboard,
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: mocks.success,
    danger: mocks.danger,
  },
}));

import { copyPageKeyWithFeedback } from "./copy-page-key";

describe("copy Page key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("copies the current key and reports success", async () => {
    mocks.writeTextToClipboard.mockResolvedValue(true);

    await expect(copyPageKeyWithFeedback("LAB-13")).resolves.toBe(true);
    expect(mocks.writeTextToClipboard).toHaveBeenCalledWith("LAB-13");
    expect(mocks.success).toHaveBeenCalledWith("Copied Page key");
    expect(mocks.danger).not.toHaveBeenCalled();
  });

  test("uses the same failure feedback when clipboard access fails", async () => {
    mocks.writeTextToClipboard.mockResolvedValue(false);

    await expect(copyPageKeyWithFeedback("LAB-13")).resolves.toBe(false);
    expect(mocks.danger).toHaveBeenCalledWith("Failed to copy Page key");
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
