import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MacDictationNativeHelperClient } from "./mac-dictation-native-helper-client";

const temporaryDirectories: string[] = [];

const createExecutable = async (source: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "nodex-dictation-helper-test-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "helper");
  await writeFile(executable, `#!/usr/bin/env node\n${source}\n`);
  await chmod(executable, 0o755);
  return executable;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => await rm(directory, { recursive: true, force: true })),
  );
});

describe("MacDictationNativeHelperClient", () => {
  it("waits for the protocol handshake and validates responses", async () => {
    const executable = await createExecutable(`
      const readline = require("node:readline");
      process.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1 }) + "\\n");
      readline.createInterface({ input: process.stdin }).on("line", (line) => {
        const request = JSON.parse(line);
        const value = request.type === "capabilities"
          ? { inputMonitoring: true, accessibility: false }
          : request.type === "queryBuiltInMic"
            ? "MacBook Pro Microphone"
            : request.type === "captureFn"
              ? { accelerator: "Fn" }
              : { registered: true };
        process.stdout.write(JSON.stringify({ type: "response", id: request.id, ok: true, value }) + "\\n");
      });
    `);
    const client = new MacDictationNativeHelperClient(executable, { validateArchitecture: false });

    await expect(client.capabilities()).resolves.toEqual({
      inputMonitoring: true,
      accessibility: false,
    });
    await expect(client.queryBuiltInMicrophoneName()).resolves.toBe("MacBook Pro Microphone");
    await expect(
      client.register({ bindingId: "hold", mode: "hold", accelerator: "Fn" }),
    ).resolves.toBeUndefined();
    await expect(client.captureFn()).resolves.toBe("Fn");
    client.dispose();
  });

  it("rejects a helper that exits before its ready handshake", async () => {
    const executable = await createExecutable("process.exit(2);");
    const client = new MacDictationNativeHelperClient(executable, { validateArchitecture: false });

    await expect(client.capabilities()).rejects.toThrow("before becoming ready");
    client.dispose();
  });

  it("rejects a symlink before spawning it", async () => {
    const executable = await createExecutable("process.exit(0);");
    const link = `${executable}-link`;
    await symlink(executable, link);
    const client = new MacDictationNativeHelperClient(link, { validateArchitecture: false });

    await expect(client.capabilities()).rejects.toThrow("not a regular executable");
  });
});
