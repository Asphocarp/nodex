import { describe, expect, test } from "vite-plus/test";
import {
  isCodexWorktreeEnvironmentConfigPath,
  requireCodexWorktreeEnvironmentConfigPath,
} from "./codex-worktree-environment-path";

describe("Codex worktree environment config paths", () => {
  test.each([
    ".codex/environments/environment.toml",
    ".codex/environments/team/dev.toml",
    ".codex\\environments\\windows.toml",
  ])("accepts the portable workspace-relative identifier %s", (value) => {
    expect(isCodexWorktreeEnvironmentConfigPath(value)).toBe(true);
    expect(requireCodexWorktreeEnvironmentConfigPath(value)).toBe(value);
  });

  test.each([
    "/repo/.codex/environments/environment.toml",
    "C:\\repo\\.codex\\environments\\environment.toml",
    ".codex/environments/../secrets.toml",
    ".codex/environment.toml",
    ".codex/environments/readme.md",
    " .codex/environments/environment.toml",
  ])("rejects the non-portable or escaping path %s", (value) => {
    expect(isCodexWorktreeEnvironmentConfigPath(value)).toBe(false);
    expect(() => requireCodexWorktreeEnvironmentConfigPath(value)).toThrow(
      "workspace-relative .toml file inside .codex/environments",
    );
  });
});
