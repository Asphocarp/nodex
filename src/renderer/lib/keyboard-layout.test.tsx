import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  KeyboardLayoutProvider,
  readKeyboardLayoutSnapshot,
  useKeyboardLayoutSnapshot,
} from "./keyboard-layout";

function LayoutProbe() {
  const snapshot = useKeyboardLayoutSnapshot();
  return <span>{snapshot.entries.KeyY ?? "fallback"}</span>;
}

describe("readKeyboardLayoutSnapshot", () => {
  test("keeps only finite canonical entries from the browser layout map", async () => {
    const values = new Map([
      ["KeyY", "f"],
      ["KeyF", "u"],
      ["KeyA", "å"],
      ["UnknownCode", "x"],
    ]);

    await expect(
      readKeyboardLayoutSnapshot({ getLayoutMap: async () => values }, 7),
    ).resolves.toEqual({
      generation: 7,
      entries: { KeyF: "U", KeyY: "F" },
    });
  });

  test("reads once when Electron exposes a layout map without EventTarget methods", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "keyboard");
    Object.defineProperty(navigator, "keyboard", {
      configurable: true,
      value: {
        getLayoutMap: async () => new Map([["KeyY", "f"]]),
      },
    });

    try {
      render(
        <KeyboardLayoutProvider>
          <LayoutProbe />
        </KeyboardLayoutProvider>,
      );

      expect(await screen.findByText("F")).toBeTruthy();
    } finally {
      if (descriptor) Object.defineProperty(navigator, "keyboard", descriptor);
      else Reflect.deleteProperty(navigator, "keyboard");
    }
  });
});
