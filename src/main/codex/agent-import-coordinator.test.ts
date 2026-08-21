import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentImportCoordinator, agentImportInternals } from "./agent-import-coordinator";

const temporaryRoots: string[] = [];

function createTemporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "nodex-agent-import-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("AgentImportCoordinator", () => {
  test("detects native history and allowlisted setup without exposing credentials", async () => {
    const root = createTemporaryRoot();
    const sourceHome = path.join(root, "source", ".codex");
    const targetHome = path.join(root, "target", "agent");
    const cwd = path.join(root, "workspace");
    mkdirSync(path.join(sourceHome, "sessions", "2026", "07", "22"), { recursive: true });
    mkdirSync(path.join(sourceHome, "skills", "reviewer"), { recursive: true });
    mkdirSync(targetHome, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(path.join(sourceHome, "skills", "reviewer", "SKILL.md"), "# Reviewer\n");
    writeFileSync(
      path.join(sourceHome, "config.toml"),
      [
        'web_search = "live"',
        'model = "secret-model"',
        'model_provider = "private-provider"',
        'approval_policy = "never"',
        'notify = ["/tmp/private-hook"]',
        "",
        "[mcp_servers.docs]",
        'command = "docs-server"',
        'env = { API_KEY = "must-be-reauthorized" }',
        "",
      ].join("\n"),
    );
    const rolloutPath = path.join(sourceHome, "sessions", "2026", "07", "22", "rollout.jsonl");
    writeFileSync(
      rolloutPath,
      `${JSON.stringify({
        payload: { cwd, id: "019c0000-0000-7000-8000-000000000001" },
        timestamp: "2026-07-22T00:00:00.000Z",
        type: "session_meta",
      })}\n`,
    );

    const appliedConfigEdits: Array<{ keyPath: string; value: unknown }> = [];
    const coordinator = new AgentImportCoordinator({
      applyConfigEdits: async (edits) => {
        appliedConfigEdits.push(...edits);
      },
      detectClaude: async () => [],
      emitProgress: () => undefined,
      forkSession: async () => "019c0000-0000-7000-8000-000000000002",
      importClaude: async () => ({ importId: "unused", itemTypeResults: [] }),
      now: () => Date.parse("2026-07-22T12:00:00.000Z"),
      runtimeStateHome: targetHome,
    });

    const scan = await coordinator.scan("codex", sourceHome);
    expect(scan.items.map((item) => item.kind)).toEqual([
      "sessions",
      "skills",
      "settings",
      "mcpServers",
    ]);
    expect(scan.items.find((item) => item.kind === "sessions")?.defaultSelected).toBe(true);
    expect(scan.items.find((item) => item.kind === "mcpServers")?.defaultSelected).toBe(false);

    const selected = scan.items.filter(
      (item) => item.kind === "skills" || item.kind === "settings" || item.kind === "mcpServers",
    );
    await coordinator.apply({ scanId: scan.scanId, itemIds: selected.map((item) => item.id) });
    expect(appliedConfigEdits.map((edit) => edit.keyPath)).toEqual(["web_search", "mcp_servers"]);
    expect(JSON.stringify(appliedConfigEdits)).not.toContain("secret-model");
    expect(JSON.stringify(appliedConfigEdits)).not.toContain("private-provider");
    expect(JSON.stringify(appliedConfigEdits)).not.toContain("private-hook");
    expect(JSON.stringify(appliedConfigEdits)).not.toContain("must-be-reauthorized");
    expect(
      readFileSync(path.join(root, "target", ".agents", "skills", "reviewer", "SKILL.md"), "utf8"),
    ).toBe("# Reviewer\n");
  });

  test("records imported rollout content and skips an unchanged session on the next scan", async () => {
    const root = createTemporaryRoot();
    const sourceHome = path.join(root, "source", ".openinterpreter");
    const targetHome = path.join(root, "target", "agent");
    const cwd = path.join(root, "workspace");
    mkdirSync(path.join(sourceHome, "sessions"), { recursive: true });
    mkdirSync(targetHome, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const rolloutPath = path.join(sourceHome, "sessions", "rollout.jsonl");
    writeFileSync(
      rolloutPath,
      `${JSON.stringify({
        payload: { cwd, id: "019c0000-0000-7000-8000-000000000003" },
        type: "session_meta",
      })}\n`,
    );
    const forkSession = vi.fn().mockResolvedValue("019c0000-0000-7000-8000-000000000004");
    const coordinator = new AgentImportCoordinator({
      applyConfigEdits: async () => undefined,
      detectClaude: async () => [],
      emitProgress: () => undefined,
      forkSession,
      importClaude: async () => ({ importId: "unused", itemTypeResults: [] }),
      now: () => Date.parse("2026-07-22T12:00:00.000Z"),
      runtimeStateHome: targetHome,
    });

    const firstScan = await coordinator.scan("open-interpreter", sourceHome);
    const sessionItem = firstScan.items.find((item) => item.kind === "sessions");
    expect(sessionItem).toBeDefined();
    await coordinator.apply({ scanId: firstScan.scanId, itemIds: [sessionItem!.id] });
    expect(forkSession).toHaveBeenCalledTimes(1);

    const secondScan = await coordinator.scan("open-interpreter", sourceHome);
    expect(secondScan.items.some((item) => item.kind === "sessions")).toBe(false);
    expect(secondScan.skippedAlreadyImportedSessions).toBe(1);
    const ledger = JSON.parse(
      readFileSync(path.join(targetHome, "imports", "session-imports-v1.json"), "utf8"),
    ) as { sessions: Array<{ targetThreadId: string }> };
    expect(ledger.sessions.map((entry) => entry.targetThreadId)).toEqual([
      "019c0000-0000-7000-8000-000000000004",
    ]);
  });

  test("replaces Claude config migration with sanitized MCP-only translation", async () => {
    const root = createTemporaryRoot();
    const sourceHome = path.join(root, ".claude");
    const targetHome = path.join(root, "target", "agent");
    mkdirSync(sourceHome, { recursive: true });
    mkdirSync(targetHome, { recursive: true });
    writeFileSync(
      path.join(sourceHome, "settings.json"),
      JSON.stringify({
        env: { ANTHROPIC_API_KEY: "not-imported" },
        mcpServers: {
          docs: {
            command: "docs-server",
            env: { API_KEY: "not-imported-either" },
          },
        },
        sandbox: { enabled: true },
      }),
    );
    const appliedConfigEdits: Array<{ keyPath: string; value: unknown }> = [];
    const coordinator = new AgentImportCoordinator({
      applyConfigEdits: async (edits) => {
        appliedConfigEdits.push(...edits);
      },
      detectClaude: async () => [
        { cwd: null, description: "unsafe config", details: null, itemType: "CONFIG" },
        { cwd: null, description: "mcp", details: null, itemType: "MCP_SERVER_CONFIG" },
      ],
      emitProgress: () => undefined,
      forkSession: async () => "unused",
      importClaude: async () => {
        throw new Error("sanitized MCP import must not call the Claude config importer");
      },
      resolveSourceHome: () => sourceHome,
      runtimeStateHome: targetHome,
    });

    const scan = await coordinator.scan("claude-code");
    expect(scan.items.map((item) => item.kind)).toEqual(["mcpServers"]);
    await coordinator.apply({ scanId: scan.scanId, itemIds: [scan.items[0]!.id] });
    expect(appliedConfigEdits).toEqual([
      {
        keyPath: "mcp_servers",
        label: "docs",
        value: { docs: { command: "docs-server" } },
      },
    ]);
  });
});

describe("agent import config policy", () => {
  test("keeps only absent, passive config keys", () => {
    const edits = agentImportInternals.buildSafeConfigEdits(
      {
        approval_policy: "never",
        features: { search: true },
        model: "private-model",
        notify: ["private-command"],
        web_search: "live",
      },
      { features: { search: false } },
    );
    expect(edits).toEqual([{ keyPath: "web_search", label: "web_search", value: "live" }]);
  });
});
