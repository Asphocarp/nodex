import { describe, expect, test } from "vitest";
import { projectDocumentWithoutBlocks } from "./external-block-drag-session";

describe("prepared external block drag", () => {
  test("removes selected nested and top-level subtrees without changing source order", () => {
    const source = [
      {
        id: "a",
        type: "paragraph",
        children: [
          { id: "a-1", type: "paragraph" },
          { id: "a-2", type: "paragraph" },
        ],
      },
      { id: "b", type: "paragraph" },
      { id: "c", type: "paragraph" },
    ];

    const projected = projectDocumentWithoutBlocks(source, ["a-1", "b"]);

    expect(projected.map((block) => block.id).join(",")).toBe("a,c");
    expect(projected[0]?.children?.map((block) => block.id).join(",")).toBe("a-2");
    expect(source[0]?.children?.map((block) => block.id).join(",")).toBe("a-1,a-2");
  });
});
