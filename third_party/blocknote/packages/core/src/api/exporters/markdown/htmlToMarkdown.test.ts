import { describe, expect, test } from "vite-plus/test";

import { htmlToMarkdown } from "./htmlToMarkdown.js";

/**
 * @vitest-environment jsdom
 */

describe("htmlToMarkdown table cells", () => {
  test("preserves literal backslashes while escaping column separators", () => {
    expect(
      htmlToMarkdown(
        "<table><tbody><tr><td>path\\name | option</td></tr></tbody></table>",
      ),
    ).toContain("path\\\\name \\| option");
  });
});
