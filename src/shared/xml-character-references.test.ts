import { describe, expect, test } from "vite-plus/test";

import { decodeXmlCharacterReferences } from "./xml-character-references";

describe("XML character references", () => {
  test("decodes named and numeric XML references exactly once", () => {
    expect(
      decodeXmlCharacterReferences(
        "&amp; &lt; &gt; &quot; &apos; &#39; &#x1F642; &amp;lt; &amp;amp;",
      ),
    ).toBe("& < > \" ' ' 🙂 &lt; &amp;");
  });

  test("preserves malformed and XML-invalid numeric references", () => {
    expect(decodeXmlCharacterReferences("&#0; &#xD800; &#x110000; &unknown;")).toBe(
      "&#0; &#xD800; &#x110000; &unknown;",
    );
  });
});
