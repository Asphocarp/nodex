import { describe, expect, test } from "vite-plus/test";
import type { PortableRichText } from "../../shared/block-documents/portable-rich-text";
import {
  createRichTitleClipboardPayload,
  resolveRichTitleClipboardColor,
  writeRichTitleClipboardPayload,
} from "./rich-title-clipboard";

describe("rich title clipboard", () => {
  test("serializes only explicit rich-text semantics instead of title presentation weight", () => {
    const value: PortableRichText = [
      { type: "text", text: "Visual ", styles: {} },
      { type: "text", text: "bold", styles: { bold: true, italic: true } },
      { type: "linebreak" },
      {
        type: "link",
        text: "Docs & more",
        href: 'https://nodex.local/?q="docs"&mode=title',
        styles: { underline: true, color: "red" },
      },
      { type: "threadMention", uuid: "12345678-mention" },
    ];

    const payload = createRichTitleClipboardPayload(value, { start: 0, end: 24 }, () => [
      { property: "color", value: "rgb(225, 100, 90)" },
    ]);

    expect(payload.plainText).toBe("Visual bold\nDocs & more@12345678");
    expect(payload.html).toBe(
      "Visual <strong><em>bold</em></strong><br>" +
        '<a href="https://nodex.local/?q=&quot;docs&quot;&amp;mode=title">' +
        '<span style="color: rgb(225, 100, 90);"><u>Docs &amp; more</u></span>' +
        "</a>@12345678",
    );
    expect(payload.html.includes("font-weight")).toBe(false);
  });

  test("clips partial selections in title coordinates", () => {
    const value: PortableRichText = [
      { type: "text", text: "Alpha", styles: {} },
      { type: "text", text: "Beta", styles: { bold: true } },
    ];

    expect(createRichTitleClipboardPayload(value, { start: 3, end: 7 })).toEqual({
      html: "ha<strong>Be</strong>",
      plainText: "haBe",
    });
  });

  test("writes rich and plain clipboard types independently", () => {
    const written = new Map<string, string>();
    const handled = writeRichTitleClipboardPayload(
      {
        setData(format, data) {
          if (format === "text/html") throw new Error("HTML unavailable");
          written.set(format, data);
        },
      },
      { html: "Plain", plainText: "Plain" },
    );

    expect(handled).toBe(true);
    expect(written).toEqual(new Map([["text/plain", "Plain"]]));
    expect(
      writeRichTitleClipboardPayload(
        {
          setData() {
            throw new Error("Clipboard unavailable");
          },
        },
        { html: "Plain", plainText: "Plain" },
      ),
    ).toBe(false);
  });

  test("resolves foreground and background colors from the active theme", () => {
    const values: Readonly<Record<string, string>> = {
      "--green-bg": "rgb(246, 249, 247)",
      "--green-text": "rgb(70, 161, 113)",
    };
    const getPropertyValue = (property: string): string => values[property] ?? "";

    expect(resolveRichTitleClipboardColor("green_bg", getPropertyValue)).toEqual([
      { property: "background-color", value: "rgb(246, 249, 247)" },
      { property: "color", value: "rgb(70, 161, 113)" },
    ]);
    expect(resolveRichTitleClipboardColor("pink", getPropertyValue)).toEqual([
      { property: "color", value: "#ad1a72" },
    ]);
  });
});
