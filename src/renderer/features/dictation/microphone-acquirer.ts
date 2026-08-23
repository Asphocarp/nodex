export interface MicrophoneAcquisitionInput {
  readonly mediaDevices: Pick<MediaDevices, "enumerateDevices" | "getUserMedia">;
  readonly selectedDeviceId: string | null;
  readonly builtInMicrophoneLabelHint?: string | null;
}

const isFallbackError = (error: unknown, names: readonly string[]): boolean =>
  Boolean(
    error &&
    typeof error === "object" &&
    "name" in error &&
    names.includes(String((error as { readonly name?: unknown }).name)),
  );

const exactAudio = (deviceId: string): MediaStreamConstraints => ({
  audio: { channelCount: 1, deviceId: { exact: deviceId } },
});

const defaultAudio: MediaStreamConstraints = { audio: { channelCount: 1 } };

const listRealInputs = async (
  mediaDevices: Pick<MediaDevices, "enumerateDevices">,
): Promise<MediaDeviceInfo[]> =>
  (await mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "audioinput" && device.deviceId !== "default",
  );

const findBuiltInInput = (
  devices: readonly MediaDeviceInfo[],
  labelHint: string | null | undefined,
): MediaDeviceInfo | null => {
  if (!labelHint?.trim()) return null;
  const normalizedHint = labelHint.trim().toLocaleLowerCase();
  return (
    devices.find((device) => device.label.trim().toLocaleLowerCase() === normalizedHint) ?? null
  );
};

/** Acquires one microphone without ever masking a permission/security failure with device fallback. */
export const acquireMicrophone = async (
  input: MicrophoneAcquisitionInput,
): Promise<MediaStream> => {
  if (input.selectedDeviceId) {
    try {
      return await input.mediaDevices.getUserMedia(exactAudio(input.selectedDeviceId));
    } catch (error) {
      if (!isFallbackError(error, ["NotFoundError", "OverconstrainedError"])) throw error;
    }
  }

  const devices = await listRealInputs(input.mediaDevices);
  const builtIn = findBuiltInInput(devices, input.builtInMicrophoneLabelHint);
  if (builtIn) {
    try {
      return await input.mediaDevices.getUserMedia(exactAudio(builtIn.deviceId));
    } catch (error) {
      if (!isFallbackError(error, ["NotFoundError", "OverconstrainedError", "NotReadableError"])) {
        throw error;
      }
    }
  }

  try {
    return await input.mediaDevices.getUserMedia(defaultAudio);
  } catch (error) {
    if (!isFallbackError(error, ["NotSupportedError"])) throw error;
  }

  const firstInput = devices[0];
  if (!firstInput) {
    throw new DOMException("No audio input device is available", "NotFoundError");
  }
  return input.mediaDevices.getUserMedia(exactAudio(firstInput.deviceId));
};
