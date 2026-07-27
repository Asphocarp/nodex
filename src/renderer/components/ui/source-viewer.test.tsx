import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SourceViewer } from "./source-viewer";

vi.mock("@/lib/use-theme", () => ({
  useTheme: () => ({ resolved: "dark" }),
}));

vi.mock("@pierre/diffs/react", () => ({
  CodeView: ({ items, options }: {
    items: Array<{
      file: { contents: string; name: string };
      version: number;
    }>;
    options: { disableLineNumbers?: boolean; overflow?: string };
  }) => {
    const file = items[0]?.file;
    return (
      <pre
        data-testid="pierre-file"
        data-filename={file?.name}
        data-line-numbers={!options.disableLineNumbers}
        data-overflow={options.overflow}
        data-version={items[0]?.version}
      >
        {file?.contents}
      </pre>
    );
  },
}));

describe("SourceViewer", () => {
  test("renders exact read-only source through the shared Pierre surface", () => {
    const view = render(
      <div style={{ height: 300 }}>
        <SourceViewer
          value={"first\nsecond"}
          ariaLabel="Workspace source"
          filename="example.ts"
          lineNumbers
          wrap
        />
      </div>,
    );

    expect(view.getByRole("region", { name: "Workspace source" })).toBeTruthy();
    const file = view.getByTestId("pierre-file");
    expect(file.textContent).toBe("first\nsecond");
    expect(file.getAttribute("data-filename")).toBe("example.ts");
    expect(file.getAttribute("data-line-numbers")).toBe("true");
    expect(file.getAttribute("data-overflow")).toBe("wrap");

    const firstVersion = file.getAttribute("data-version");
    view.rerender(
      <div style={{ height: 300 }}>
        <SourceViewer
          value={"third\nvalue"}
          ariaLabel="Workspace source"
          filename="example.ts"
          lineNumbers
          wrap
        />
      </div>,
    );
    expect(view.getByTestId("pierre-file").textContent).toBe("third\nvalue");
    expect(view.getByTestId("pierre-file").getAttribute("data-version")).not.toBe(
      firstVersion,
    );
  });
});
