import { describe, expect, test } from "vitest";
import { render } from "@/test/dom";
import {
  prepareNfmEditorForMutation,
  type NfmEditorMutationRuntime,
} from "./nfm-editor-relocation";

describe("NfmEditor mutation preparation", () => {
  test("blurs only its own editor and waits for the DOM boundary", async () => {
    const view = render(
      <>
        <div data-testid="surface-editor">
          <div contentEditable data-testid="editor-content" />
        </div>
        <input aria-label="Other surface" />
      </>,
    );
    const container = view.getByTestId("surface-editor");
    const content = view.getByTestId("editor-content");
    const other = view.getByRole("textbox", {
      name: "Other surface",
    }) as HTMLInputElement;
    let blurCalls = 0;
    const runtime: NfmEditorMutationRuntime = {
      isFocused: () => content.ownerDocument.activeElement === content,
      isWithinEditor: (element) => container.contains(element),
      blur: () => {
        blurCalls += 1;
        content.blur();
      },
    };

    content.focus();
    await prepareNfmEditorForMutation(runtime, container);
    expect(blurCalls).toBe(1);
    expect(content.ownerDocument.activeElement === content).toBe(false);
    other.focus();
    await prepareNfmEditorForMutation(runtime, container);
    expect(other.ownerDocument.activeElement === other).toBe(true);
    expect(blurCalls).toBe(1);
  });
});
