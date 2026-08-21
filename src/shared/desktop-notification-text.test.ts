import { describe, expect, test } from "vitest";
import { toDesktopNotificationPlainText } from "./desktop-notification-text";

describe("desktop notification plain text", () => {
  test("removes executable HTML, tags, markdown decoration, and line breaks", () => {
    expect(
      toDesktopNotificationPlainText(
        [
          "# **Done**",
          "<script>alert('secret')</script>",
          "<style>.hidden { color: red }</style>",
          "Read [the report](https://example.com) &amp; continue.<br>Now.",
        ].join("\n"),
      ),
    ).toBe("Done Read the report & continue. Now.");
  });

  test("decodes numeric entities and bounds output", () => {
    expect(toDesktopNotificationPlainText("A &#x1f680; B &#67;", 6)).toBe("A 🚀 B…");
    expect(toDesktopNotificationPlainText(null)).toBe("");
  });
});
