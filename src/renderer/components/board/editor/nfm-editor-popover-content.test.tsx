import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { NodexPopover, NodexPopoverTrigger } from "@/components/ui/popover";
import { render, settleAsyncRender } from "@/test/dom";
import { NfmEditorPopoverContent } from "./nfm-editor-popover-content";

describe("nfm editor popover content", () => {
  test("prevents open autofocus while still calling provided handlers", async () => {
    let openAutoFocusCalls = 0;
    let closeAutoFocusCalls = 0;
    const focusProbe = document.createElement("button");
    focusProbe.type = "button";
    document.body.appendChild(focusProbe);
    focusProbe.focus();

    try {
      const view = render(
        <NodexPopover>
          <NodexPopoverTrigger asChild>
            <button type="button">Open editor popover</button>
          </NodexPopoverTrigger>
          <NfmEditorPopoverContent
            onOpenAutoFocus={() => {
              openAutoFocusCalls += 1;
            }}
            onCloseAutoFocus={() => {
              closeAutoFocusCalls += 1;
            }}
          >
            <input aria-label="Picker search" />
          </NfmEditorPopoverContent>
        </NodexPopover>,
      );

      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Open editor popover" }));
        await settleAsyncRender();
      });

      const input = view.getByRole("textbox", { name: "Picker search" });
      expect(openAutoFocusCalls).toBe(1);
      expect(document.activeElement === input).toBe(false);

      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Open editor popover" }));
        await settleAsyncRender();
      });

      expect(closeAutoFocusCalls).toBe(1);
      expect(view.queryByRole("textbox", { name: "Picker search" }) === null).toBe(true);
    } finally {
      focusProbe.remove();
    }
  });
});
