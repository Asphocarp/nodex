import { describe, expect, test } from "vite-plus/test";

import {
  buildCodexCommandApprovalPreview,
  formatCodexExecPolicyAmendmentCommand,
  formatCodexExecPolicyAmendmentMenuSummary,
  getDisplayCommand,
} from "./codex-command-execution";
import type { CodexApprovalRequest } from "./types";

function buildCommandRequest(overrides?: Partial<CodexApprovalRequest>): CodexApprovalRequest {
  return {
    type: "approval",
    requestId: "approval-1",
    kind: "command",
    projectId: "project-1",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "cmd-1",
    createdAt: 1,
    ...overrides,
  };
}

describe("codex command execution helpers", () => {
  test("keeps command display unwrapping available from the shared command model", () => {
    expect(getDisplayCommand("/bin/zsh -lc 'echo hello'")).toBe("echo hello");
    expect(getDisplayCommand("git status --short")).toBe("git status --short");
  });

  test("builds command approval previews from command action commands first", () => {
    const preview = buildCodexCommandApprovalPreview(
      buildCommandRequest({
        command: "bash -lc 'cat package.json'",
        commandActions: [
          { type: "read", command: "cat package.json", name: "package.json", path: "package.json" },
          { type: "search", command: "rg TODO src", query: "TODO", path: "src" },
        ],
        cmd: ["legacy", "fallback"],
      }),
    );

    expect(preview?.kind ?? "").toBe("command");
    expect(preview?.kind === "command" ? preview.commandText : "").toBe(
      "cat package.json && rg TODO src",
    );
  });

  test("falls back to an Electron-style execpolicy amendment command", () => {
    const preview = buildCodexCommandApprovalPreview(
      buildCommandRequest({
        proposedExecpolicyAmendment: ["git", "commit", "-m", "hello world"],
      }),
    );

    expect(formatCodexExecPolicyAmendmentCommand(["git", "commit", "-m", "hello world"])).toBe(
      'git commit -m "hello world"',
    );
    expect(preview?.kind === "command" ? preview.commandText : "").toBe(
      'git commit -m "hello world"',
    );
  });

  test("keeps multiline execpolicy amendments out of compact menu descriptions", () => {
    expect(
      formatCodexExecPolicyAmendmentMenuSummary(["bash", "-lc", "echo one\necho two"]) ?? "",
    ).toBe("");
  });

  test("builds network approval previews without requiring command text", () => {
    const preview = buildCodexCommandApprovalPreview(
      buildCommandRequest({
        networkApprovalContext: {
          host: "api.example.com",
          protocol: "https",
        },
      }),
    );

    expect(preview?.kind ?? "").toBe("network");
    expect(preview?.kind === "network" ? preview.reason : "").toBe(
      "Reason: api.example.com isn't on the current network allowlist",
    );
  });
});
