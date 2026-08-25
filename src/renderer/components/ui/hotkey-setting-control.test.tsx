import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { invoke } from "@/lib/api";
import { HotkeySettingControl, bareModifierIdentity } from "./hotkey-setting-control";

vi.mock("@/lib/api", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(null);
});

function renderCapture(onCapture: (accelerator: string) => void, allowsBareModifiers = true) {
  render(
    <HotkeySettingControl
      accelerator="Ctrl+Space"
      acceleratorLabel="⌃Space"
      allowsBareModifiers={allowsBareModifiers}
      captureAriaLabel="Toggle dictation hotkey capture"
      hotkeyName="Toggle dictation hotkey"
      isCapturing
      onCancelCapture={() => undefined}
      onCapture={onCapture}
      onClear={() => undefined}
      onStartCapture={() => undefined}
      platform="macOS"
    />,
  );
  return screen.getByRole("textbox", { name: "Toggle dictation hotkey capture" });
}

describe("HotkeySettingControl", () => {
  test("keeps a modifier key pending so Ctrl+Y is captured as one chord", () => {
    const onCapture = vi.fn();
    const input = renderCapture(onCapture);

    fireEvent.keyDown(input, {
      altKey: false,
      code: "ControlLeft",
      ctrlKey: true,
      key: "Control",
      location: 1,
      metaKey: false,
      shiftKey: false,
    });
    expect(onCapture).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("Press shortcut");

    fireEvent.keyDown(input, {
      altKey: false,
      code: "KeyY",
      ctrlKey: true,
      key: "y",
      location: 0,
      metaKey: false,
      shiftKey: false,
    });

    expect(onCapture).toHaveBeenCalledOnce();
    expect(onCapture).toHaveBeenCalledWith("Ctrl+Y");
  });

  test("ignores non-Fn values from the native Fn-only capture boundary", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("Ctrl" as never);
    const onCapture = vi.fn();
    const input = renderCapture(onCapture);

    fireEvent.keyDown(input, {
      code: "ControlLeft",
      ctrlKey: true,
      key: "Control",
      location: 1,
    });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("global-dictation-capture-fn-hotkey"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onCapture).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("Press shortcut");

    fireEvent.keyDown(input, {
      code: "KeyY",
      ctrlKey: true,
      key: "y",
      location: 0,
    });
    expect(onCapture).toHaveBeenCalledWith("Ctrl+Y");
  });

  test("accepts Fn from the native Fn-only capture boundary", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("Fn");
    const onCapture = vi.fn();

    renderCapture(onCapture);

    await waitFor(() => expect(onCapture).toHaveBeenCalledWith("Fn"));
  });

  test("keeps modifiers pending for ordinary shortcuts that disallow modifier-only bindings", () => {
    const onCapture = vi.fn();
    const input = renderCapture(onCapture, false);

    fireEvent.keyDown(input, {
      code: "ControlLeft",
      ctrlKey: true,
      key: "Control",
      location: 1,
    });
    fireEvent.keyDown(input, {
      code: "ShiftLeft",
      ctrlKey: true,
      key: "Shift",
      location: 1,
      shiftKey: true,
    });
    expect(onCapture).not.toHaveBeenCalled();

    fireEvent.keyDown(input, {
      code: "KeyY",
      ctrlKey: true,
      key: "y",
      shiftKey: true,
    });
    expect(onCapture).toHaveBeenCalledWith("Ctrl+Shift+Y");
  });

  test("commits a bare left modifier only when the matching key is released", () => {
    const onCapture = vi.fn();
    const input = renderCapture(onCapture);

    fireEvent.keyDown(input, {
      ctrlKey: true,
      key: "Control",
      location: 1,
    });
    expect(onCapture).not.toHaveBeenCalled();

    fireEvent.keyUp(input, {
      ctrlKey: false,
      key: "Control",
      location: 1,
    });
    expect(onCapture).toHaveBeenCalledWith("LeftControl");
  });

  test("preserves modifier side and rejects right Control as a bare shortcut", () => {
    expect(
      bareModifierIdentity(
        {
          altKey: true,
          ctrlKey: false,
          key: "Alt",
          location: 2,
          metaKey: false,
          shiftKey: false,
        },
        "pressed",
      ),
    ).toBe("RightOption");
    expect(
      bareModifierIdentity(
        {
          altKey: false,
          ctrlKey: true,
          key: "Control",
          location: 2,
          metaKey: false,
          shiftKey: false,
        },
        "pressed",
      ),
    ).toBeNull();
  });
});
