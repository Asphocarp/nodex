import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GlobalDictationBar, GlobalDictationRoot } from "./global-dictation-page";

describe("GlobalDictationBar", () => {
  it("exposes retry and dismiss actions in an actionable error state", () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    render(
      <GlobalDictationBar
        state="error"
        waveform={[]}
        error={{ kind: "paste-failed", operation: "paste", retryable: true }}
        onCancel={onCancel}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.getByText("Couldn’t paste text")).toBeTruthy();
  });

  it("offers the macOS settings shortcut when Accessibility blocks paste", () => {
    const onOpenSettings = vi.fn();
    render(
      <GlobalDictationBar
        state="error"
        waveform={[]}
        error={{ kind: "accessibility-denied", operation: "paste", retryable: true }}
        onCancel={() => undefined}
        onOpenSettings={onOpenSettings}
        onRetry={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.getByText("Accessibility access is required")).toBeTruthy();
  });

  it("renders the live waveform without adding retry during capture", () => {
    const { container } = render(
      <GlobalDictationBar
        state="listening"
        waveform={[0.2, 0.8, 0.4]}
        onCancel={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText("Listening")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(container.querySelectorAll("span[style]")).toHaveLength(48);
  });
});

describe("GlobalDictationRoot", () => {
  it("announces readiness through the restricted bridge", async () => {
    const sendEvent = vi.fn(async () => undefined);
    const descriptor = Object.getOwnPropertyDescriptor(window, "globalDictation");
    Object.defineProperty(window, "globalDictation", {
      configurable: true,
      value: {
        invoke: async (channel: string) =>
          channel === "codex:dictation:settings:read"
            ? {
                microphoneInputDeviceId: null,
                keepGlobalBarVisible: false,
                playStartSound: true,
                playStopSound: true,
                globalShortcutNudgeDismissed: false,
                dictionary: [],
              }
            : null,
        onCommand: () => () => undefined,
        sendEvent,
      },
    });
    try {
      render(<GlobalDictationRoot />);
      await vi.waitFor(() => expect(sendEvent).toHaveBeenCalledWith({ type: "ready" }));
      expect(screen.getByText("Ready")).toBeTruthy();
    } finally {
      if (descriptor) Object.defineProperty(window, "globalDictation", descriptor);
      else Reflect.deleteProperty(window, "globalDictation");
    }
  });
});
