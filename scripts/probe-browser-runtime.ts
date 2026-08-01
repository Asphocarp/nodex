#!/usr/bin/env tsx

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  McpServerToolCallResponse,
  ThreadStartResponse,
} from "@nodex/codex-app-server-protocol/v2";
import { CodexAppServerClient } from "../src/main/codex/codex-app-server-client";
import { BrowserPluginReconciler } from "../src/main/codex/browser-plugin-reconciler";
import { BrowserUseThreadConfigBuilder } from "../src/main/codex/browser-use-thread-config";
import { resolveCodexRuntime } from "../src/main/codex/codex-runtime";
import { BrowserUseNativePipeServer } from "../src/main/browser-use/browser-use-native-pipe-server";
import { createBrowserUsePeerAuthorizer } from "../src/main/browser-use/browser-use-peer-authorizer";

type BrowserRuntimeProbeReport = {
  appServerCompatibilityVersion: string;
  browserPluginVersion: string;
  browserRuntimeVersions: {
    codexCli: string;
    cuaRuntime: string;
    node: string;
    peerAuthorization: string;
  };
  nativePipeMethods: string[];
  nodeReplResult: string;
  targetArch: string;
  targetPlatform: string;
};

interface BrowserRuntimeCleanupDependencies {
  readonly closeNativePipeServer: () => Promise<void>;
  readonly removeStateHome: () => void;
  readonly stopClient: () => Promise<void>;
}

export async function cleanupBrowserRuntime(
  dependencies: BrowserRuntimeCleanupDependencies,
): Promise<void> {
  let firstError: unknown;
  let hasError = false;
  const operations = [
    dependencies.stopClient,
    dependencies.closeNativePipeServer,
    dependencies.removeStateHome,
  ];

  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      if (hasError) continue;
      firstError = error;
      hasError = true;
    }
  }

  if (hasError) throw firstError;
}

function textFromToolResponse(response: McpServerToolCallResponse): string {
  return response.content.flatMap((entry) => {
    if (
      typeof entry === "object"
      && entry !== null
      && "type" in entry
      && entry.type === "text"
      && "text" in entry
      && typeof entry.text === "string"
    ) {
      return [entry.text];
    }
    return [];
  }).join("\n");
}

const TRUSTED_BRIDGE_PROBE_SOURCE = `
const trustedNodeRepl = globalThis.nodeRepl;

export function inspectTrustedBridge() {
  return {
    authenticatedFetchAvailable: typeof trustedNodeRepl?.fetch === "function",
    nativePipeAvailable:
      typeof trustedNodeRepl?.nativePipe?.createConnection === "function",
    requestMetaAvailable: trustedNodeRepl?.requestMeta != null,
  };
}
`;

function makeBrowserClientProbeCode(
  browserClientPath: string,
  trustedBridgeProbePath: string,
): string {
  return `
const { inspectTrustedBridge } = await import(${JSON.stringify(trustedBridgeProbePath)});
if (globalThis.agent?.browsers == null) {
  const { setupBrowserRuntime } = await import(${JSON.stringify(browserClientPath)});
  await setupBrowserRuntime({ globals: globalThis });
}
globalThis.browser = await agent.browsers.get("iab");
const probeInfo = (await agent.browsers.list()).find(
  (candidate) => candidate.id === browser.browserId,
);
nodeRepl.write(JSON.stringify({
  backendType: probeInfo?.type,
  browserId: browser.browserId,
  documentationLength: (await browser.documentation()).length,
  rootNodeRepl: {
    fetchAvailable: typeof globalThis.nodeRepl?.fetch === "function",
    keys: Object.keys(globalThis.nodeRepl ?? {}).sort(),
    requestMetaAvailable: globalThis.nodeRepl?.requestMeta != null,
  },
  trustedBridge: inspectTrustedBridge(),
}));
`;
}

export async function probeBrowserRuntime(projectRoot: string): Promise<BrowserRuntimeProbeReport> {
  const runtime = resolveCodexRuntime({
    isPackaged: false,
    projectRootPath: projectRoot,
  });
  if (runtime.browserRuntime.status === "unavailable") {
    throw new Error(runtime.browserRuntime.message);
  }
  if (!runtime.codexCompatibilityVersion) {
    throw new Error("Agent runtime is missing its Codex compatibility version");
  }

  const bundle = runtime.browserRuntime.bundle;
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-browser-runtime-probe-"));
  const trustedBridgeProbePath = path.join(stateHome, "trusted-bridge-probe.mjs");
  fs.writeFileSync(trustedBridgeProbePath, TRUSTED_BRIDGE_PROBE_SOURCE, {
    encoding: "utf8",
    mode: 0o600,
  });
  const trustedBridgeProbeSha256 = createHash("sha256")
    .update(TRUSTED_BRIDGE_PROBE_SOURCE)
    .digest("hex");
  const sessionId = randomUUID();
  const turnId = randomUUID();
  const nativePipeMethods: string[] = [];
  const nativePipeDiagnostics: string[] = [];
  const nativePipeServer = new BrowserUseNativePipeServer({
    events: {
      onAuthorizationError: (error) => {
        nativePipeDiagnostics.push(
          `authorization-error:${error instanceof Error ? error.message : String(error)}`,
        );
      },
      onRejectedSocket: (result) => {
        nativePipeDiagnostics.push(`rejected:${JSON.stringify(result)}`);
      },
      onSocketError: (error) => {
        nativePipeDiagnostics.push(`socket-error:${error.message}`);
      },
    },
    handler: (request) => {
      nativePipeMethods.push(request.method);
      if (request.method === "ping") return "pong";
      if (request.method === "getInfo") {
        return {
          apiSupportOverrides: {},
          capabilities: { browser: [], tab: [] },
          metadata: {
            codexAppBuildFlavor: bundle.manifest.buildFlavor,
            codexAppSessionId: "runtime-probe",
            codexSessionId: sessionId,
          },
          name: "Nodex Browser Runtime Probe",
          type: "iab",
          version: bundle.manifest.desktopBuild,
        };
      }
      throw new Error(`Unexpected Browser runtime probe method: ${request.method}`);
    },
    socketPeerAuthorizer: createBrowserUsePeerAuthorizer({
      addonPath: bundle.paths.peerAuthorization,
      mode: "disabled",
    }),
  });
  const client = new CodexAppServerClient({
    additionalSearchPaths: runtime.additionalSearchPaths,
    binaryPath: runtime.binaryPath,
    clientInfo: {
      name: "nodex-browser-runtime-probe",
      title: "Nodex Browser Runtime Probe",
      version: "1.0.0",
    },
    env: {
      ...process.env,
      CODEX_HOME: stateHome,
      INTERPRETER_HOME: stateHome,
    },
    expectedCodexHome: stateHome,
    logStderr: false,
    requestTimeoutMs: 150_000,
  });

  try {
    await nativePipeServer.start();
    await client.start();
    const reconciliation = await new BrowserPluginReconciler({
      browserRuntime: runtime.browserRuntime,
      client,
    }).ensureInstalled();
    if (reconciliation.status !== "ready") throw new Error(reconciliation.message);

    const browserConfig = await new BrowserUseThreadConfigBuilder({
      availableBackends: () => ["iab"],
      browserRuntime: runtime.browserRuntime,
      runtimeStateHome: stateHome,
    }).build();
    if (!browserConfig) throw new Error("Verified Browser runtime did not build thread config");
    const nodeReplConfig = browserConfig["mcp_servers.node_repl"];
    if (
      typeof nodeReplConfig !== "object"
      || nodeReplConfig === null
      || !("env" in nodeReplConfig)
      || typeof nodeReplConfig.env !== "object"
      || nodeReplConfig.env === null
      || Array.isArray(nodeReplConfig.env)
    ) {
      throw new Error("Browser runtime thread config is missing Node REPL environment");
    }
    const nodeReplEnv = nodeReplConfig.env;
    const trustedClientHashes =
      nodeReplEnv.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S;
    if (typeof trustedClientHashes !== "string" || trustedClientHashes.length === 0) {
      throw new Error("Browser runtime thread config is missing its trusted client hash");
    }
    nodeReplEnv.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S =
      `${trustedClientHashes},${trustedBridgeProbeSha256}`;

    const threadResponse = await client.request<ThreadStartResponse>("thread/start", {
      config: browserConfig,
      cwd: projectRoot,
      ephemeral: true,
    });
    const threadId = threadResponse.thread.id;
    const toolResponse = await client.request<McpServerToolCallResponse>(
      "mcpServer/tool/call",
      {
        _meta: {
          "x-codex-turn-metadata": {
            session_id: sessionId,
            thread_id: threadId,
            turn_id: turnId,
          },
        },
        arguments: {
          code: makeBrowserClientProbeCode(
            bundle.paths.browserPluginClient,
            trustedBridgeProbePath,
          ),
        },
        server: "node_repl",
        threadId,
        tool: "js",
      },
    );
    const nodeReplResult = textFromToolResponse(toolResponse);
    if (
      toolResponse.isError
      || !nodeReplResult.includes('"backendType":"iab"')
      || !nodeReplResult.includes('"rootNodeRepl":{"fetchAvailable":false')
      || !nodeReplResult.includes(
        '"trustedBridge":{"authenticatedFetchAvailable":true,"nativePipeAvailable":true',
      )
    ) {
      throw new Error(
        `Browser client conformance failed: ${nodeReplResult || "empty result"}`
        + (nativePipeDiagnostics.length > 0
          ? ` (${nativePipeDiagnostics.join("; ")})`
          : ""),
      );
    }
    if (!nativePipeMethods.includes("getInfo")) {
      throw new Error("Browser client did not reach the native-pipe Browser backend");
    }

    return {
      appServerCompatibilityVersion: runtime.codexCompatibilityVersion,
      browserPluginVersion: bundle.manifest.browserPlugin.version,
      browserRuntimeVersions: bundle.manifest.runtimeVersions,
      nativePipeMethods: [...new Set(nativePipeMethods)],
      nodeReplResult,
      targetArch: bundle.manifest.targetArch,
      targetPlatform: bundle.manifest.targetPlatform,
    };
  } finally {
    await cleanupBrowserRuntime({
      closeNativePipeServer: () => nativePipeServer.close(),
      removeStateHome: () => fs.rmSync(stateHome, {
        force: true,
        maxRetries: 10,
        recursive: true,
        retryDelay: 100,
      }),
      stopClient: () => client.stop(),
    });
  }
}

function isDirectExecution(): boolean {
  const scriptPath = process.argv[1];
  return typeof scriptPath === "string"
    && path.resolve(scriptPath) === path.resolve(new URL(import.meta.url).pathname);
}

if (isDirectExecution()) {
  const projectRoot = path.resolve(process.cwd());
  probeBrowserRuntime(projectRoot).then(
    (report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
