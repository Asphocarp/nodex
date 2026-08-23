import { describe, expect, test, vi } from "vite-plus/test";
import {
  createSystemMicrophonePermissionService,
  type HostMicrophoneAccessStatus,
} from "./system-microphone-permission-service";

function createFixture(input: {
  readonly askResult?: boolean | Error;
  readonly platform?: NodeJS.Platform;
  readonly statuses: readonly (HostMicrophoneAccessStatus | Error)[];
}) {
  let statusIndex = 0;
  const getMediaAccessStatus = vi.fn(() => {
    const value = input.statuses[Math.min(statusIndex, input.statuses.length - 1)];
    statusIndex += 1;
    if (value instanceof Error) throw value;
    if (!value) throw new Error("A fixture microphone status is required");
    return value;
  });
  const askForMediaAccess = vi.fn(async () => {
    if (input.askResult instanceof Error) throw input.askResult;
    return input.askResult ?? true;
  });
  const service = createSystemMicrophonePermissionService({
    platform: input.platform ?? "darwin",
    systemPreferences: { askForMediaAccess, getMediaAccessStatus },
  });
  return { askForMediaAccess, getMediaAccessStatus, service };
}

describe("system microphone permission service", () => {
  test("reports unavailable without touching TCC on unsupported platforms", async () => {
    const fixture = createFixture({ platform: "win32", statuses: ["granted"] });

    expect(fixture.service.readStatus()).toBe("unavailable");
    await expect(fixture.service.requestAccess()).resolves.toEqual({
      kind: "unavailable",
      status: "unavailable",
    });
    expect(fixture.getMediaAccessStatus).not.toHaveBeenCalled();
    expect(fixture.askForMediaAccess).not.toHaveBeenCalled();
  });

  test.each(["granted", "denied", "restricted", "unknown"] as const)(
    "does not prompt again from the %s state",
    async (status) => {
      const fixture = createFixture({ statuses: [status] });

      await expect(fixture.service.requestAccess()).resolves.toEqual(
        status === "granted"
          ? { kind: "granted", status: "granted" }
          : status === "unknown"
            ? { kind: "unavailable", status: "unknown" }
            : { kind: "blocked", restartRequired: true, status },
      );
      expect(fixture.askForMediaAccess).not.toHaveBeenCalled();
    },
  );

  test("prompts only from not-determined and trusts the reread status", async () => {
    const fixture = createFixture({
      askResult: false,
      statuses: ["not-determined", "granted"],
    });

    await expect(fixture.service.requestAccess()).resolves.toEqual({
      kind: "granted",
      status: "granted",
    });
    expect(fixture.askForMediaAccess).toHaveBeenCalledOnce();
    expect(fixture.getMediaAccessStatus).toHaveBeenCalledTimes(2);
  });

  test("returns the reread blocked state after a declined prompt", async () => {
    const fixture = createFixture({
      askResult: true,
      statuses: ["not-determined", "denied"],
    });

    await expect(fixture.service.requestAccess()).resolves.toEqual({
      kind: "blocked",
      restartRequired: true,
      status: "denied",
    });
  });

  test("classifies status, prompt, and unresolved failures", async () => {
    const failure = (nativeName: string) => ({
      kind: "failed",
      error: {
        kind: "unknown",
        operation: "permission",
        retryable: true,
        nativeName,
      },
    });
    await expect(
      createFixture({ statuses: [new Error("TCC unavailable")] }).service.requestAccess(),
    ).resolves.toEqual(failure("StatusReadFailed"));
    await expect(
      createFixture({
        askResult: new Error("prompt failed"),
        statuses: ["not-determined"],
      }).service.requestAccess(),
    ).resolves.toEqual(failure("RequestFailed"));
    await expect(
      createFixture({ statuses: ["not-determined", "not-determined"] }).service.requestAccess(),
    ).resolves.toEqual(failure("StatusUnresolved"));
  });

  test("maps a read exception to the stable unknown status", () => {
    const fixture = createFixture({ statuses: [new Error("TCC unavailable")] });
    expect(fixture.service.readStatus()).toBe("unknown");
  });
});
