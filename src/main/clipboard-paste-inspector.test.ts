import { describe, expect, test } from "vite-plus/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  CLIPBOARD_INSPECTION_MAX_ITEMS,
  CLIPBOARD_INSPECTION_MAX_LINES,
  CLIPBOARD_INSPECTION_MAX_PATH_LENGTH,
  inspectClipboardPasteItemsFromStrings,
  truncateClipboardUtf8,
} from "./clipboard-paste-inspector";

describe("clipboard paste inspector", () => {
  test("collects unique pasted file and folder paths from text payloads", () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-clipboard-inspect-"));
    const filePath = path.join(fixtureRoot, "notes.txt");
    const folderPath = path.join(fixtureRoot, "folder");
    fs.writeFileSync(filePath, "hello");
    fs.mkdirSync(folderPath, { recursive: true });

    const result = inspectClipboardPasteItemsFromStrings([
      `file://${filePath}\n${folderPath}`,
      `${filePath}\n${filePath}`,
      "# comment\nmissing.txt",
    ]);

    expect(result.items.length).toBe(2);
    expect(result.items[0]?.path).toBe(filePath);
    expect(result.items[0]?.kind).toBe("file");
    expect(result.items[0]?.bytes).toBe(5);
    expect(result.items[1]?.path).toBe(folderPath);
    expect(result.items[1]?.kind).toBe("folder");
  });

  test("ignores non-absolute and missing clipboard entries", () => {
    const result = inspectClipboardPasteItemsFromStrings([
      "relative/path.txt",
      "",
      "https://example.com/file.txt",
    ]);

    expect(result.items.length).toBe(0);
  });

  test("enforces item, line, path, and symlink budgets", () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-clipboard-budget-"));
    const paths = Array.from({ length: CLIPBOARD_INSPECTION_MAX_ITEMS + 4 }, (_, index) =>
      path.join(fixtureRoot, `item-${index}.txt`),
    );
    for (const filePath of paths) fs.writeFileSync(filePath, "x");
    const symlinkPath = path.join(fixtureRoot, "symlink.txt");
    fs.symlinkSync(paths[0] ?? "", symlinkPath);
    const excessivePath = `/${"x".repeat(CLIPBOARD_INSPECTION_MAX_PATH_LENGTH + 1)}`;
    const extraLines = Array.from({ length: CLIPBOARD_INSPECTION_MAX_LINES + 4 }, () => paths[0]);

    const result = inspectClipboardPasteItemsFromStrings([
      [symlinkPath, excessivePath, ...paths, ...extraLines].join("\n"),
    ]);

    expect(result.items).toHaveLength(CLIPBOARD_INSPECTION_MAX_ITEMS);
    expect(result.items.some((item) => item.path === symlinkPath)).toBe(false);
  });

  test("truncates payloads at a valid UTF-8 boundary without exceeding the budget", () => {
    const truncated = truncateClipboardUtf8("A日B", 3);

    expect(truncated).toBe("A");
    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(3);
    expect(truncated).not.toContain("�");
  });
});
