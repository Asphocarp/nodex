import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildCodexPosixSetupCaptureWrapper,
  captureCodexShellEnvironmentDelta,
  loadCodexLocalShellEnvironment,
  parseCodexCapturedEnvironment,
  parseCodexInteractiveShellEnvironment,
  persistCodexWorktreeShellEnvironment,
  runCodexWorktreeSetupScript,
} from "./codex-worktree-shell-environment";

describe("Codex worktree shell environment", () => {
  test("parses captured env output and preserves equals signs in values", () => {
    expect(JSON.stringify(parseCodexCapturedEnvironment("\uFEFFA=1\nTOKEN=a=b\ninvalid\n"))).toBe(
      JSON.stringify({ A: "1", TOKEN: "a=b" }),
    );
  });

  test("parses the exact interactive login-shell delimiter section", () => {
    expect(JSON.stringify(parseCodexInteractiveShellEnvironment([
      "shell startup chatter",
      "_SHELL_ENV_DELIMITER_PATH=/opt/homebrew/bin:/usr/bin",
      "TOKEN=a=b  ",
      "_SHELL_ENV_DELIMITER_trailing chatter",
    ].join("\n")))).toBe(JSON.stringify({
      PATH: "/opt/homebrew/bin:/usr/bin",
      TOKEN: "a=b",
    }));
  });

  test("merges the interactive login-shell environment over the Electron environment", async () => {
    const environment = await loadCodexLocalShellEnvironment({
      platform: "darwin",
      baseEnvironment: {
        APP_ONLY: "present",
        CODEX_SHELL: "parent-only",
        PATH: "/usr/bin",
      },
      loadInteractiveEnvironment: async () => ({
        CODEX_SHELL: "temporary",
        HOMEBREW_PREFIX: "/opt/homebrew",
        PATH: "/opt/homebrew/bin:/usr/bin",
      }),
    });

    expect(JSON.stringify(environment)).toBe(JSON.stringify({
      APP_ONLY: "present",
      PATH: "/opt/homebrew/bin:/usr/bin",
      HOMEBREW_PREFIX: "/opt/homebrew",
    }));
  });

  test("falls back to the Electron environment when login-shell loading fails", async () => {
    let observedError = "";
    const environment = await loadCodexLocalShellEnvironment({
      platform: "darwin",
      baseEnvironment: {
        CODEX_SHELL: "temporary",
        PATH: "/usr/bin",
      },
      loadInteractiveEnvironment: async () => {
        throw new Error("shell startup failed");
      },
      onError: (error) => {
        observedError = error instanceof Error ? error.message : String(error);
      },
    });

    expect(JSON.stringify(environment)).toBe(JSON.stringify({ PATH: "/usr/bin" }));
    expect(observedError).toBe("shell startup failed");
  });

  test("uses the process environment unchanged on Windows", async () => {
    const environment = await loadCodexLocalShellEnvironment({
      platform: "win32",
      baseEnvironment: {
        CODEX_SHELL: "preserved-on-windows",
        Path: "C:\\Windows",
      },
      loadInteractiveEnvironment: async () => ({ Path: "should-not-load" }),
    });

    expect(JSON.stringify(environment)).toBe(JSON.stringify({
      CODEX_SHELL: "preserved-on-windows",
      Path: "C:\\Windows",
    }));
  });

  test("captures sorted stable changes and removals while filtering volatile setup keys", () => {
    const delta = captureCodexShellEnvironmentDelta({
      KEEP: "same",
      REMOVE: "old",
      UPDATE: "old",
      PWD: "/before",
      BASH_FUNC_fixture: "() { echo before; }",
      MULTILINE: "before\nvalue",
    }, {
      KEEP: "same",
      UPDATE: "new",
      ADD: "value",
      PWD: "/after",
      BASH_FUNC_fixture: "() { echo after; }",
      MULTILINE: "after\nvalue",
    }, "darwin");

    expect(JSON.stringify(delta)).toBe(JSON.stringify({
      version: 1,
      set: { ADD: "value", UPDATE: "new" },
      exclude: ["REMOVE"],
    }));
  });

  test("matches Windows environment keys case-insensitively and preserves the after key", () => {
    expect(JSON.stringify(captureCodexShellEnvironmentDelta(
      { Path: "before" },
      { PATH: "after" },
      "win32",
    ))).toBe(JSON.stringify({
      version: 1,
      set: { PATH: "after" },
      exclude: [],
    }));
  });

  test("returns null when setup leaves no stable environment difference", () => {
    expect(captureCodexShellEnvironmentDelta({ A: "1" }, { A: "1" }, "darwin")).toBe(null);
  });

  test("builds the exact POSIX source-and-trap wrapper with safe path quoting", () => {
    expect(buildCodexPosixSetupCaptureWrapper({
      scriptPath: "/tmp/it's/setup.sh",
      capturePath: "/tmp/after env",
      beforeCapturePath: "/tmp/before env",
    })).toBe([
      "set -xeo pipefail",
      "capture_path='/tmp/after env'",
      "before_capture_path='/tmp/before env'",
      'env > "$before_capture_path"',
      `trap 'code=$?; if [ "$code" -eq 0 ]; then env > "$capture_path"; fi' EXIT`,
      ". '/tmp/it'\\''s/setup.sh'",
    ].join("\n"));
  });

  test("sources setup in a real shell and captures exported and removed variables", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "nodex-shell-capture-test-"));
    const output: string[] = [];
    try {
      const delta = await runCodexWorktreeSetupScript({
        cwd,
        script: [
          "export NODEX_CAPTURE_TEST=ready",
          "unset NODEX_REMOVE_TEST",
          'printf "captured-output:$TERM:$FORCE_COLOR:$COLORTERM:$NODEX_LOGIN_ENV_TEST"',
        ].join("\n"),
        environment: { NODEX_REMOVE_TEST: "before" },
        loadBaseEnvironment: async () => ({
          ...process.env,
          NODEX_LOGIN_ENV_TEST: "from-login-shell",
        }),
        onOutput: (chunk) => output.push(chunk.data),
      });

      expect(JSON.stringify(delta)).toBe(JSON.stringify({
        version: 1,
        set: { NODEX_CAPTURE_TEST: "ready" },
        exclude: ["NODEX_REMOVE_TEST"],
      }));
      expect(
        output.join("").includes(
          "captured-output:xterm-256color:1:truecolor:from-login-shell",
        ),
      ).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("does not capture a failed setup environment", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "nodex-shell-capture-fail-test-"));
    try {
      let message = "";
      try {
        await runCodexWorktreeSetupScript({
          cwd,
          script: "export SHOULD_NOT_PERSIST=yes\nexit 9",
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.includes("setup script failed")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("cancels an active setup through its lifecycle AbortSignal", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "nodex-shell-capture-cancel-test-"));
    const controller = new AbortController();
    try {
      let message = "";
      try {
        await runCodexWorktreeSetupScript({
          cwd,
          script: [
            'printf "setup-ready\\n"',
            "trap 'exit 0' TERM",
            "while :; do sleep 0.05; done",
          ].join("\n"),
          signal: controller.signal,
          onOutput: (output) => {
            if (output.data.includes("setup-ready")) controller.abort();
          },
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe("Worktree environment setup canceled.");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("keeps cancellation active through post-success environment capture", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "nodex-shell-post-capture-cancel-test-"));
    const controller = new AbortController();
    let markCaptureStarted: () => void = () => undefined;
    let releaseCapture: () => void = () => undefined;
    const captureStarted = new Promise<void>((resolve) => {
      markCaptureStarted = resolve;
    });
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    try {
      const setup = runCodexWorktreeSetupScript({
        cwd,
        script: "export NODEX_CAPTURE_AFTER_SUCCESS=ready",
        signal: controller.signal,
        loadBaseEnvironment: async () => process.env,
        readEnvironmentCapture: async (filePath) => {
          markCaptureStarted();
          await captureGate;
          return await readFile(filePath, "utf8");
        },
      });
      await captureStarted;
      controller.abort();
      releaseCapture();

      let message = "";
      try {
        await setup;
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe("Worktree environment setup canceled.");
    } finally {
      releaseCapture();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("persists and clears the exact worktree git-path payload", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "nodex-shell-persist-test-"));
    const configPath = path.join(cwd, "codex-shell-environment.json");
    const resolveGitPath = async () => configPath;
    try {
      await persistCodexWorktreeShellEnvironment({
        cwd,
        shellEnvironment: {
          version: 1,
          set: { CAPTURED: "yes" },
          exclude: ["REMOVED"],
        },
        resolveGitPath,
      });
      expect(await readFile(configPath, "utf8")).toBe([
        "{",
        '  "version": 1,',
        '  "set": {',
        '    "CAPTURED": "yes"',
        "  },",
        '  "exclude": [',
        '    "REMOVED"',
        "  ]",
        "}",
        "",
      ].join("\n"));

      await persistCodexWorktreeShellEnvironment({
        cwd,
        shellEnvironment: null,
        resolveGitPath,
      });
      let exists = true;
      try {
        await readFile(configPath, "utf8");
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
