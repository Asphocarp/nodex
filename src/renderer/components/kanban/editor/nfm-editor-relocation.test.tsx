import { describe, expect, test } from "vitest";
import { render } from "@/test/dom";
import {
  applyNfmEditorWriteFence,
  prepareNfmEditorForRelocation,
  type NfmEditorRelocationRuntime,
} from "./nfm-editor-relocation";

describe("NfmEditor relocation write fence", () => {
  test("blurs only its own editor, waits, and toggles editability", async () => {
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
    const runtime: NfmEditorRelocationRuntime = {
      isEditable: true,
      isFocused: () => content.ownerDocument.activeElement === content,
      isWithinEditor: (element) => container.contains(element),
      blur: () => {
        blurCalls += 1;
        content.blur();
      },
    };

    content.focus();
    await prepareNfmEditorForRelocation(runtime, container);
    expect(blurCalls).toBe(1);
    expect(content.ownerDocument.activeElement === content).toBe(false);
    expect(runtime.isEditable).toBe(false);

    applyNfmEditorWriteFence(runtime, false);
    expect(runtime.isEditable).toBe(true);
    other.focus();
    await prepareNfmEditorForRelocation(runtime, container);
    expect(other.ownerDocument.activeElement === other).toBe(true);
    expect(blurCalls).toBe(1);
  });
});
