import { describe, expect, test } from "bun:test";
import { components as blockNoteShadcnComponents } from "@blocknote/shadcn";
import { render } from "@/test/dom";

describe("BlockNote shadcn suggestion roots", () => {
  test("passes ARIA state through the suggestion menu root", () => {
    const SuggestionRoot = blockNoteShadcnComponents.SuggestionMenu.Root;

    const view = render(
      <SuggestionRoot
        id="bn-suggestion-menu"
        aria-busy
        data-test="suggestion-root"
      >
        <div>Loading</div>
      </SuggestionRoot>,
    );

    const root = view.container.querySelector("#bn-suggestion-menu");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("role")).toBe("listbox");
    expect(root?.getAttribute("aria-busy")).toBe("true");
    expect(root?.getAttribute("data-test")).toBe("suggestion-root");
  });

  test("passes ARIA state through the grid suggestion menu root", () => {
    const GridSuggestionRoot = blockNoteShadcnComponents.GridSuggestionMenu.Root;

    const view = render(
      <GridSuggestionRoot
        id="bn-grid-suggestion-menu"
        columns={4}
        aria-busy
        data-test="grid-suggestion-root"
        style={{ maxHeight: "12px" }}
      >
        <div>Loading</div>
      </GridSuggestionRoot>,
    );

    const root = view.container.querySelector("#bn-grid-suggestion-menu") as HTMLElement | null;
    expect(root).not.toBeNull();
    expect(root?.getAttribute("role")).toBe("grid");
    expect(root?.getAttribute("aria-busy")).toBe("true");
    expect(root?.getAttribute("data-test")).toBe("grid-suggestion-root");
    expect(root?.style.maxHeight).toBe("12px");
    expect(root?.style.gridTemplateColumns).toBe("repeat(4, 1fr)");
  });
});
