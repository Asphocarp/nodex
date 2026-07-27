import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { WorkspacePierreEditor } from "./workspace-pierre-editor";

vi.mock("@/lib/use-theme", () => ({
  useTheme: () => ({ resolved: "dark" }),
}));

vi.mock("@pierre/diffs/react", () => ({
  EditProvider: ({ children }: { children: React.ReactNode }) => children,
  CodeView: ({
    items,
    onItemEditChange,
  }: {
    items: Array<{ file: { contents: string; name: string }; edit: boolean }>;
    onItemEditChange: (
      item: unknown,
      file: { contents: string; name: string },
    ) => void;
  }) => (
    <button
      type="button"
      data-testid="editable-pierre-file"
      data-editable={items[0]?.edit}
      onClick={() => onItemEditChange(items[0], {
        name: items[0]?.file.name ?? "file",
        contents: "edited",
      })}
    >
      {items[0]?.file.contents}
    </button>
  ),
}));

describe("WorkspacePierreEditor", () => {
  test("renders an editable Pierre item and delivers exact document changes", () => {
    const onChange = vi.fn();
    const view = render(
      <WorkspacePierreEditor
        value="original"
        filename="index.ts"
        language="typescript"
        sourceIdentity="/repo/index.ts"
        documentVersion={0}
        ariaLabel="Editor"
        onChange={onChange}
      />,
    );

    const editor = view.getByTestId("editable-pierre-file");
    expect(editor.getAttribute("data-editable")).toBe("true");
    editor.click();
    expect(onChange).toHaveBeenCalledWith("edited");
  });
});
