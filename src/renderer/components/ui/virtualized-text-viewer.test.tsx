import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { VirtualizedTextViewer } from "./virtualized-text-viewer";

describe("VirtualizedTextViewer", () => {
  test("mounts selectable read-only source with a concise accessible label", () => {
    const view = render(
      <div style={{ height: 300 }}>
        <VirtualizedTextViewer
          value={"first\nsecond"}
          ariaLabel="Workspace source"
          lineNumbers
        />
      </div>,
    );

    const content = view.container.querySelector<HTMLElement>(".cm-content");
    expect(content?.getAttribute("contenteditable")).toBe("false");
    expect(content?.getAttribute("aria-label")).toBe("Workspace source");
    expect(content?.getAttribute("aria-readonly")).toBe("true");
    expect(content?.textContent).toContain("first");
    expect(content?.textContent).toContain("second");
  });

  test("destroys each editor view across repeated mount cycles", () => {
    const destroy = vi.spyOn(EditorView.prototype, "destroy");
    try {
      const first = render(
        <VirtualizedTextViewer value="one" ariaLabel="First source" />,
      );
      first.unmount();
      const second = render(
        <VirtualizedTextViewer value="two" ariaLabel="Second source" />,
      );
      second.unmount();

      expect(destroy).toHaveBeenCalledTimes(2);
    } finally {
      destroy.mockRestore();
    }
  });

  test("keeps mounted line DOM bounded for a large document", () => {
    const value = Array.from({ length: 20_000 }, (_, index) => `line ${index}`).join("\n");
    const view = render(
      <div style={{ height: 300 }}>
        <VirtualizedTextViewer value={value} ariaLabel="Large source" />
      </div>,
    );

    expect(view.container.querySelectorAll(".cm-line").length).toBeLessThan(500);
  });
});
