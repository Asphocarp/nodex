import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { TerminalManager } from "./terminal-manager";

const owner = { id: 41 } as Electron.WebContents;
const windowSessionId = "terminal-native-contract-window";
const sessionId = "terminal-native-contract";

describe.skipIf(process.platform === "win32")("TerminalManager native PTY contract", () => {
  const managers: TerminalManager[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const manager of managers.splice(0)) manager.killAll();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("loads the Electron ABI, honors cwd, transports writes, and observes teardown", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "nodex-native-pty-"));
    directories.push(cwd);
    const manager = new TerminalManager();
    managers.push(manager);
    let output = "";
    manager.configureEventPublisher({
      broadcast: () => undefined,
      sendToWebContentsId: (_webContentsId, channel, payload) => {
        if (channel === "terminal-data" && "data" in payload) output += payload.data;
      },
    });

    const created = manager.create(owner, windowSessionId, {
      sessionId,
      cwd,
      size: { cols: 80, rows: 24 },
    }, () => undefined);
    expect(created).toMatchObject({ status: "acquired" });
    if (created.status !== "acquired") throw new Error("Expected the native PTY lease to be acquired.");
    expect(created.snapshot?.osPid).toBeTypeOf("number");

    manager.write(
      owner,
      windowSessionId,
      sessionId,
      "printf '__NODEX_PTY_CWD__:%s\\n' \"$PWD\"\r",
      () => undefined,
    );
    await expect.poll(() => output, { timeout: 5_000 }).toContain(`__NODEX_PTY_CWD__:${cwd}`);

    manager.write(owner, windowSessionId, sessionId, "exit\r", () => undefined);
    await expect.poll(() => manager.getSessionSnapshot(sessionId)?.exited, { timeout: 5_000 })
      .toBe(true);
  });
});
