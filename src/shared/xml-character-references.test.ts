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

  test("ignores leading zeroes when validating numeric reference bounds", () => {
    expect(decodeXmlCharacterReferences("&#00000000065; &#x00000000041;")).toBe("A A");
    expect(decodeXmlCharacterReferences("&#0000000012345678; &#x00000001100000;")).toBe(
      "&#0000000012345678; &#x00000001100000;",
    );
  });
});
