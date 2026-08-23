import { describe, expect, it, vi } from "vitest";
import { acquireMicrophone } from "./microphone-acquirer";

const device = (deviceId: string, label: string): MediaDeviceInfo =>
  ({ deviceId, groupId: "", kind: "audioinput", label, toJSON: () => ({}) }) as MediaDeviceInfo;

const stream = {} as MediaStream;

describe("acquireMicrophone", () => {
  it("falls from a missing selected device to the native built-in microphone hint", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("missing", "NotFoundError"))
      .mockResolvedValueOnce(stream);

    await expect(
      acquireMicrophone({
        mediaDevices: {
          enumerateDevices: async () => [device("builtin", "MacBook Pro Microphone")],
          getUserMedia,
        },
        selectedDeviceId: "removed",
        builtInMicrophoneLabelHint: "MacBook Pro Microphone",
      }),
    ).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: { channelCount: 1, deviceId: { exact: "builtin" } },
    });
  });

  it("never masks a permission failure by switching devices", async () => {
    const permissionError = new DOMException("blocked", "NotAllowedError");
    const getUserMedia = vi.fn(async () => {
      throw permissionError;
    });
    const enumerateDevices = vi.fn(async () => [device("other", "Other")]);

    await expect(
      acquireMicrophone({
        mediaDevices: { enumerateDevices, getUserMedia },
        selectedDeviceId: "selected",
      }),
    ).rejects.toBe(permissionError);
    expect(enumerateDevices).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("uses the first real input only when the system default is unsupported", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("unsupported", "NotSupportedError"))
      .mockResolvedValueOnce(stream);

    await expect(
      acquireMicrophone({
        mediaDevices: {
          enumerateDevices: async () => [
            device("default", "Default"),
            device("first", "First microphone"),
          ],
          getUserMedia,
        },
        selectedDeviceId: null,
      }),
    ).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: { channelCount: 1, deviceId: { exact: "first" } },
    });
  });
});
