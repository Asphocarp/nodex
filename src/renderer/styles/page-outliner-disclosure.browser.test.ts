import { afterEach, describe, expect, test } from "vite-plus/test";
import "../../../third_party/blocknote/packages/core/src/editor/Block.css";

function createDisclosure(expanded: boolean) {
  const wrapper = document.createElement("div");
  wrapper.className = "bn-toggle-wrapper";
  wrapper.dataset.showChildren = expanded ? "true" : "false";

  const caret = document.createElement("button");
  caret.className = "bn-toggle-button";
  caret.type = "button";
  wrapper.append(caret);

  return { caret, wrapper };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("nested Page outliner disclosure styling", () => {
  test("each caret reflects only its own disclosure wrapper", () => {
    const outer = createDisclosure(true);
    const inner = createDisclosure(false);
    outer.wrapper.append(inner.wrapper);
    document.body.append(outer.wrapper);

    expect(getComputedStyle(outer.caret).transform).not.toBe("none");
    expect(getComputedStyle(inner.caret).transform).toBe("none");

    outer.wrapper.dataset.showChildren = "false";
    inner.wrapper.dataset.showChildren = "true";

    expect(getComputedStyle(outer.caret).transform).toBe("none");
    expect(getComputedStyle(inner.caret).transform).not.toBe("none");
  });
});
