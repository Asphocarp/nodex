import { describe, expect, test } from "bun:test";
import { resolveDefaultTerminalCommand } from "./terminal-manager";

describe("resolveDefaultTerminalCommand", () => {
  test("starts zsh as an interactive login shell", () => {
    expect(JSON.stringify(resolveDefaultTerminalCommand("/bin/zsh", "darwin"))).toBe(
      JSON.stringify(["/bin/zsh", "-l", "-i"]),
    );
  });

  test("starts bash with its login and interactive flags", () => {
    expect(JSON.stringify(resolveDefaultTerminalCommand("/bin/bash", "linux"))).toBe(
      JSON.stringify(["/bin/bash", "--login", "-i"]),
    );
  });

  test("starts unknown POSIX shells interactively without assuming login support", () => {
    expect(JSON.stringify(resolveDefaultTerminalCommand("/bin/sh", "linux"))).toBe(
      JSON.stringify(["/bin/sh", "-i"]),
    );
  });

  test("does not add POSIX shell flags on Windows", () => {
    expect(JSON.stringify(resolveDefaultTerminalCommand("powershell.exe", "win32"))).toBe(
      JSON.stringify(["powershell.exe"]),
    );
  });
});
