import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CODEX_SERVER_REQUEST_NO_RESPONSE,
  CodexAppServerClient,
  resolveCodexStderrLogLevel,
} from "./codex-app-server-client";
import { subscribeToBackendLogs } from "../logging/logger";

function makeMockServerScript(): { scriptPath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-client-"));
  const scriptPath = path.join(dir, "mock-server.mjs");

  fs.writeFileSync(
    scriptPath,
    [
      "import readline from 'node:readline';",
      "const rl = readline.createInterface({ input: process.stdin });",
      "let pendingTriggerId = null;",
      "let nextIgnoredRequestId = 9100;",
      "const ignoredRequests = new Map();",
      "function send(msg) { process.stdout.write(JSON.stringify(msg) + '\\n'); }",
      "rl.on('line', (line) => {",
      "  if (!line.trim()) return;",
      "  const msg = JSON.parse(line);",
      "  if (msg.method === 'initialize') {",
      "    const userAgent = process.env.NODEX_TEST_CAPTURE_INITIALIZE === '1'",
      "      ? JSON.stringify(msg.params?.capabilities ?? null)",
      "      : process.env.NODEX_TEST_RUNTIME_ENV || 'mock/0.0.1';",
      "    send({ id: msg.id, result: { userAgent, codexHome: '/tmp/mock-codex-home', platformFamily: 'unix', platformOs: 'macos' } });",
      "    return;",
      "  }",
      "  if (msg.method === 'initialized') { return; }",
      "  if (msg.method === 'echo') {",
      "    const delay = Number(msg.params?.delay ?? 0);",
      "    setTimeout(() => send({ id: msg.id, result: { value: msg.params?.value } }), delay);",
      "    return;",
      "  }",
      "  if (msg.method === 'emitStderr') {",
      "    process.stderr.write(String(msg.params?.line ?? '') + '\\n');",
      "    send({ id: msg.id, result: {} });",
      "    return;",
      "  }",
      "  if (msg.method === 'triggerApproval') {",
      "    pendingTriggerId = msg.id;",
      "    send({",
      "      id: 9001,",
      "      method: 'item/commandExecution/requestApproval',",
      "      params: {",
      "        threadId: 'thr_test',",
      "        turnId: 'turn_test',",
      "        itemId: 'item_test',",
      "        startedAtMs: Date.now(),",
      "        environmentId: null,",
      "        command: 'echo hi',",
      "        cwd: '/tmp',",
      "      },",
      "    });",
      "    return;",
      "  }",
      "  if (msg.method === 'triggerIgnoredRequest') {",
      "    const serverRequestId = nextIgnoredRequestId++;",
      "    const state = { triggerId: msg.id, responded: false };",
      "    ignoredRequests.set(serverRequestId, state);",
      "    send({ id: serverRequestId, method: msg.params.method, params: msg.params.params ?? {} });",
      "    setTimeout(() => {",
      "      send({ id: state.triggerId, result: { responded: state.responded } });",
      "      ignoredRequests.delete(serverRequestId);",
      "    }, 30);",
      "    return;",
      "  }",
      "  if (ignoredRequests.has(msg.id)) {",
      "    ignoredRequests.get(msg.id).responded = true;",
      "    return;",
      "  }",
      "  if (msg.id === 9001) {",
      "    if (pendingTriggerId !== null) send({ id: pendingTriggerId, result: { approved: msg.result?.decision ?? null } });",
      "    pendingTriggerId = null;",
      "    return;",
      "  }",
      "  if (Object.prototype.hasOwnProperty.call(msg, 'id')) {",
      "    send({ id: msg.id, result: {} });",
      "  }",
      "});",
    ].join("\n"),
    "utf8",
  );

  return {
    scriptPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function makeBinaryShim(binaryName: string): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-shim-"));
  const shimPath = path.join(dir, binaryName);
  const escapedExecPath = JSON.stringify(process.execPath);

  fs.writeFileSync(
    shimPath,
    `#!/usr/bin/env bash\nexec ${escapedExecPath} "$@"\n`,
    "utf8",
  );
  fs.chmodSync(shimPath, 0o755);

  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe("codex-app-server-client", () => {
  test("derives stderr severity from structured and tracing-formatted diagnostics", () => {
    expect(resolveCodexStderrLogLevel('{"level":"DEBUG","message":"cache hit"}')).toBe("debug");
    expect(resolveCodexStderrLogLevel("2026-07-14T12:34:56.000Z WARN codex_core: retrying")).toBe("warn");
    expect(resolveCodexStderrLogLevel("plain diagnostic without a level")).toBe("info");
  });

  test("initializes, correlates concurrent requests, and handles server requests", async () => {
    const mock = makeMockServerScript();
    const client = new CodexAppServerClient({
      binaryPath: process.execPath,
      args: [mock.scriptPath],
      clientInfo: {
        name: "test-client",
        title: "Test Client",
        version: "0.0.1",
      },
    });

    try {
      client.setServerRequestHandler(async (request) => {
        if (request.method === "item/commandExecution/requestApproval") {
          return { decision: "accept" };
        }
        return {};
      });

      await client.start();
      expect(client.getInitializeResponse()).toEqual({
        userAgent: "mock/0.0.1",
        codexHome: "/tmp/mock-codex-home",
        platformFamily: "unix",
        platformOs: "macos",
      });

      const [first, second] = await Promise.all([
        client.request<{ value: string }>("echo", { value: "first", delay: 40 }),
        client.request<{ value: string }>("echo", { value: "second", delay: 5 }),
      ]);

      expect(first.value).toBe("first");
      expect(second.value).toBe("second");

      const approval = await client.request<{ approved: string }>("triggerApproval", {});
      expect(approval.approved).toBe("accept");
    } finally {
      await client.stop();
      expect(client.getInitializeResponse()).toBeNull();
      mock.cleanup();
    }
  });

  test("advertises support for OpenAI form elicitations during initialize", async () => {
    const mock = makeMockServerScript();
    const client = new CodexAppServerClient({
      binaryPath: process.execPath,
      args: [mock.scriptPath],
      env: {
        ...process.env,
        NODEX_TEST_CAPTURE_INITIALIZE: "1",
      },
    });

    try {
      await client.start();
      expect(JSON.parse(client.getInitializeResponse()?.userAgent ?? "null")).toEqual({
        experimentalApi: true,
        mcpServerOpenaiFormElicitation: true,
        requestAttestation: false,
      });
    } finally {
      await client.stop();
      mock.cleanup();
    }
  });

  test("reports missing binary state", async () => {
    const client = new CodexAppServerClient({
      binaryPath: "__missing_codex_binary_for_test__",
      missingBinaryMessage: "Bundled Codex runtime is missing or corrupted. Reinstall Nodex.",
    });

    try {
      let threw = false;
      try {
        await client.start();
      } catch {
        threw = true;
      }

      expect(threw).toBe(true);
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        if (client.getState().status === "missingBinary") break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(client.getState().status).toBe("missingBinary");
      expect(client.getState().message).toBe("Bundled Codex runtime is missing or corrupted. Reinstall Nodex.");
    } finally {
      await client.stop();
    }
  });

  test("can abandon ignored server requests without writing JSON-RPC responses", async () => {
    const mock = makeMockServerScript();
    const client = new CodexAppServerClient({
      binaryPath: process.execPath,
      args: [mock.scriptPath],
    });

    try {
      client.setServerRequestHandler(async () => CODEX_SERVER_REQUEST_NO_RESPONSE);
      await client.start();

      for (const method of [
        "account/chatgptAuthTokens/refresh",
        "attestation/generate",
        "applyPatchApproval",
        "execCommandApproval",
      ]) {
        const params = method === "account/chatgptAuthTokens/refresh"
          ? { reason: "unauthorized" }
          : method === "applyPatchApproval"
            ? { conversationId: "thread-1", callId: "call-1", fileChanges: {}, reason: null, grantRoot: null }
            : method === "execCommandApproval"
              ? {
                  conversationId: "thread-1",
                  callId: "call-1",
                  approvalId: null,
                  command: ["echo", "hi"],
                  cwd: "/tmp",
                  reason: null,
                  parsedCmd: [],
                }
              : {};
        const result = await client.request<{ responded: boolean }>("triggerIgnoredRequest", {
          method,
          params,
        });
        expect(result.responded).toBe(false);
      }
    } finally {
      await client.stop();
      mock.cleanup();
    }
  });

  test("never writes a completed server-request response into a replacement process", async () => {
    const client = new CodexAppServerClient({
      binaryPath: process.execPath,
    });
    let resolveHandler: (value: { decision: "accept" }) => void = () => {
      throw new Error("Server-request resolver was not initialized");
    };
    const handlerResult = new Promise<{ decision: "accept" }>((resolve) => {
      resolveHandler = resolve;
    });
    client.setServerRequestHandler(async () => await handlerResult);

    const firstWrite = vi.fn();
    const secondWrite = vi.fn();
    const firstChild = {
      stdin: { destroyed: false, write: firstWrite },
    };
    const secondChild = {
      stdin: { destroyed: false, write: secondWrite },
    };
    const clientInternals = client as unknown as {
      child: unknown;
      handleServerRequest: (request: {
        id: number;
        method: "item/commandExecution/requestApproval";
        params: {
          threadId: string;
          turnId: string;
          itemId: string;
          command: string;
          cwd: string;
        };
      }) => Promise<void>;
    };

    clientInternals.child = firstChild;
    const handling = clientInternals.handleServerRequest({
      id: 41,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-old-generation",
        turnId: "turn-old-generation",
        itemId: "item-old-generation",
        command: "echo stale",
        cwd: "/tmp",
      },
    });
    clientInternals.child = secondChild;
    resolveHandler({ decision: "accept" });
    await handling;

    expect(firstWrite).not.toHaveBeenCalled();
    expect(secondWrite).not.toHaveBeenCalled();
  });

  test("resolves binaries from additional search paths when PATH is restricted", async () => {
    const mock = makeMockServerScript();
    const binaryName = "codex-test-shim";
    const shim = makeBinaryShim(binaryName);
    const client = new CodexAppServerClient({
      binaryPath: binaryName,
      args: [mock.scriptPath],
      env: { ...process.env, PATH: "/usr/bin:/bin" },
      additionalSearchPaths: [shim.dir],
    });

    try {
      await client.start();
      expect(client.getState().status).toBe("connected");
    } finally {
      await client.stop();
      mock.cleanup();
      shim.cleanup();
    }
  });

  test("resolves the child environment again after a controlled restart", async () => {
    const mock = makeMockServerScript();
    let runtimeValue = "first-runtime";
    const client = new CodexAppServerClient({
      binaryPath: process.execPath,
      args: [mock.scriptPath],
      resolveEnv: () => ({
        ...process.env,
        NODEX_TEST_RUNTIME_ENV: runtimeValue,
      }),
    });

    try {
      await client.start();
      expect(client.getInitializeResponse()?.userAgent).toBe("first-runtime");
      await client.stop();
      runtimeValue = "second-runtime";
      await client.start();
      expect(client.getInitializeResponse()?.userAgent).toBe("second-runtime");
    } finally {
      await client.stop();
      mock.cleanup();
    }
  });

  test("emits structured logs for RPC requests", async () => {
    const mock = makeMockServerScript();
    const captured: Array<Record<string, unknown>> = [];
    const unsubscribe = subscribeToBackendLogs((entry) => {
      captured.push(entry);
    }, { level: "trace" });
    const client = new CodexAppServerClient({
      binaryPath: process.execPath,
      args: [mock.scriptPath],
      clientInfo: {
        name: "test-client",
        title: "Test Client",
        version: "0.0.1",
      },
    });

    try {
      await client.start();
      await client.request<{ value: string }>("echo", { value: "log-me" });

      const hasSendLog = captured.some((entry) => {
        return entry.level === "debug" && entry.msg === "Sending Codex RPC request" && entry.method === "echo";
      });
      const hasResponseLog = captured.some((entry) => {
        return entry.level === "debug" && entry.msg === "Codex RPC request completed" && entry.method === "echo";
      });

      expect(hasSendLog).toBe(true);
      expect(hasResponseLog).toBe(true);
    } finally {
      unsubscribe();
      await client.stop();
      mock.cleanup();
    }
  });

  test("records each app-server stderr line once at its declared severity", async () => {
    const mock = makeMockServerScript();
    const captured: Array<Record<string, unknown>> = [];
    const unsubscribe = subscribeToBackendLogs((entry) => {
      captured.push(entry);
    }, { level: "trace" });
    const client = new CodexAppServerClient({
      binaryPath: process.execPath,
      args: [mock.scriptPath],
    });

    try {
      await client.start();
      const line = "2026-07-14T12:34:56.000Z WARN codex_core: retrying";
      await client.request("emitStderr", { line });

      const deadline = Date.now() + 1_000;
      while (
        Date.now() < deadline
        && !captured.some((entry) => entry.msg === "Codex app-server diagnostic")
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const stderrRecords = captured.filter((entry) =>
        entry.msg === "Codex app-server diagnostic" && entry.line === line
      );
      expect(stderrRecords).toHaveLength(1);
      expect(stderrRecords[0]?.level).toBe("warn");
    } finally {
      unsubscribe();
      await client.stop();
      mock.cleanup();
    }
  });
});
