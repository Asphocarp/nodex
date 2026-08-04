import { describe, expect, test } from "vitest";
import { readFileLinkOpener, writeFileLinkOpener } from "./file-link-opener-settings";

describe("file-link opener preference", () => {
  test("persists and normalizes the selected opener", () => {
    const previous = localStorage.getItem("nodex-markdown-file-link-opener-v1");
    try {
      expect(writeFileLinkOpener("fileManager")).toBe("fileManager");
      expect(readFileLinkOpener()).toBe("fileManager");
    } finally {
      if (previous === null) {
        localStorage.removeItem("nodex-markdown-file-link-opener-v1");
      } else {
        localStorage.setItem("nodex-markdown-file-link-opener-v1", previous);
      }
    }
  });
});
