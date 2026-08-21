import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { writeTextToClipboard, writeTextToClipboardStrict } from "./clipboard";

const originalApi = window.api;
const originalClipboard = navigator.clipboard;
const originalExecCommand = document.execCommand;

afterEach(() => {
  window.api = originalApi;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: originalExecCommand,
  });
});

describe("renderer text clipboard", () => {
  test("strict writes recover through the shared DOM fallback when Web Clipboard is denied", async () => {
    const browserWriteText = vi.fn(async () => {
      throw new Error("Clipboard permission denied");
    });
    const execCommand = vi.fn((command: string) => command === "copy");
    window.api = undefined;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: browserWriteText },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await expect(writeTextToClipboardStrict("complete transcript")).resolves.toBeUndefined();

    expect(browserWriteText).toHaveBeenCalledWith("complete transcript");
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  test("keeps browser clipboard support when no Electron bridge exists", async () => {
    const browserWriteText = vi.fn(async () => undefined);
    window.api = undefined;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: browserWriteText },
    });

    await expect(writeTextToClipboard("browser task")).resolves.toBe(true);

    expect(browserWriteText).toHaveBeenCalledWith("browser task");
  });
});
