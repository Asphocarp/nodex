import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vite-plus/test";
import { ComputerUseSettingsView } from "./computer-use-settings-page";

const snapshot = {
  alwaysHidePictureInPicture: false,
  approvedApps: [{ bundleIdentifier: "com.apple.Safari", displayName: "Safari" }],
  approvedMessageThreads: [{ chatGuid: "thread-1", displayName: "Family" }],
  available: true,
  lockedUseAllowed: true,
  lockedUseEnabled: false,
  message: null,
  soundMode: "foregroundClicks" as const,
};

describe("ComputerUseSettingsView", () => {
  test("routes native policy controls and approval removals", () => {
    const onRemoveAppApproval = vi.fn();
    const onRemoveMessageApproval = vi.fn();
    const onSetAlwaysHidePictureInPicture = vi.fn();
    const onSetLockedUseEnabled = vi.fn();

    render(
      <ComputerUseSettingsView
        pending={null}
        snapshot={snapshot}
        onRemoveAppApproval={onRemoveAppApproval}
        onRemoveMessageApproval={onRemoveMessageApproval}
        onSetAlwaysHidePictureInPicture={onSetAlwaysHidePictureInPicture}
        onSetLockedUseEnabled={onSetLockedUseEnabled}
        onSetSoundMode={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Enable Locked use" }));
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Always hide picture in picture",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Safari" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Family" }));

    expect(onSetLockedUseEnabled).toHaveBeenCalledWith(true);
    expect(onSetAlwaysHidePictureInPicture).toHaveBeenCalledWith(true);
    expect(onRemoveAppApproval).toHaveBeenCalledWith("com.apple.Safari");
    expect(onRemoveMessageApproval).toHaveBeenCalledWith("thread-1");
  });

  test("does not expose locked use when configuration requirements deny it", () => {
    render(
      <ComputerUseSettingsView
        pending={null}
        snapshot={{
          ...snapshot,
          lockedUseAllowed: false,
          lockedUseEnabled: null,
        }}
        onRemoveAppApproval={() => undefined}
        onRemoveMessageApproval={() => undefined}
        onSetAlwaysHidePictureInPicture={() => undefined}
        onSetLockedUseEnabled={() => undefined}
        onSetSoundMode={() => undefined}
      />,
    );

    expect(screen.queryByRole("switch", { name: "Enable Locked use" })).toBeNull();
  });
});
