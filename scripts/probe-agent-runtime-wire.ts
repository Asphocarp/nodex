import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type { ServerNotification } from "@nodex/codex-app-server-protocol";
import { ScopedCallbackRuntime } from "../src/main/app/ScopedCallbackRuntime";
import { resolveCodexRuntime } from "../src/main/codex/codex-runtime";
import {
  type CodexProbeClient,
  runCodexProbeMain,
  withCodexProbeSession,
} from "./codex-probe-session";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const conformanceText = "NODEX_WIRE_CONFORMANCE_OK";
const requestTimeoutMs = 30_000;
const temporaryRootCleanupRetries = 10;
const temporaryRootCleanupRetryDelayMs = 100;

type WireApi = "responses" | "chat" | "messages";
type MultiAgentPlacement = "code-mode-nested" | "direct" | "direct-model-only";
type ExpectedMultiAgentVersion = "disabled" | "v1" | "v2";

type WireCase = {
  readonly agentsEnabled?: boolean;
  readonly collabFeatureEnabled?: boolean;
  readonly ephemeral?: boolean;
  readonly expectedMultiAgentVersion?: ExpectedMultiAgentVersion;
  readonly harnessId: "native" | "kimi-code" | "claude-code";
  readonly modelId: string;
  readonly multiAgentPlacement?: MultiAgentPlacement;
  readonly multiAgentV2FeatureEnabled?: boolean;
  readonly providerId: string;
  readonly toolNamespace?: string;
  readonly waitAgentEnabled?: boolean;
  readonly wireApi: WireApi;
};

type RecordedRequest = {
  readonly authorizationScheme: string | null;
  readonly body: Record<string, unknown>;
  readonly credentialHeader: "authorization" | "x-api-key" | null;
  readonly path: string;
};

type WireCaseResult = {
  readonly agentsEnabled: boolean;
  readonly authorizationScheme: string | null;
  readonly collabFeatureEnabled: boolean | null;
  readonly credentialHeader: "authorization" | "x-api-key" | null;
  readonly harnessId: WireCase["harnessId"];
  readonly modelId: string;
  readonly multiAgentPlacement: MultiAgentPlacement;
  readonly multiAgentVersion: ExpectedMultiAgentVersion | "external-harness";
  readonly multiAgentV1Tools: readonly string[];
  readonly multiAgentV2Effective: boolean;
  readonly multiAgentV2FeatureEnabled: boolean;
  readonly multiAgentV2Tools: readonly string[];
  readonly path: string;
  readonly providerId: string;
  readonly requestHasTools: boolean;
  readonly requestCount: number;
  readonly responseTextObserved: boolean;
  readonly threadId: string;
  readonly toolNamespace: string;
  readonly waitAgentEnabled: boolean;
  readonly wireApi: WireApi;
};

export type AgentRuntimeWireConformanceReport = {
  readonly binaryPath: string;
  readonly cases: WireCaseResult[];
  readonly generatedAt: string;
  readonly isolatedPerThreadConfig: "pass";
  readonly multiAgentDirectModelAndCodeModeSelection: "pass";
  readonly multiAgentV2ToolSelection: "pass";
  readonly nativeSelectionMatrix: "pass";
  readonly persistedLegacyV1ResumeSelection: "pass";
  readonly persistedResumeSelection: "pass";
};

const multiAgentV2Actions = [
  "spawn_agent",
  "send_message",
  "followup_task",
  "wait_agent",
  "interrupt_agent",
  "list_agents",
] as const;

const multiAgentV1Actions = [
  "close_agent",
  "resume_agent",
  "send_input",
  "spawn_agent",
  "wait_agent",
] as const;

const multiAgentV1Namespace = "multi_agent_v1";

const wireCases: readonly WireCase[] = [
  {
    providerId: "nodex-mock-responses",
    modelId: "mock-responses-model",
    harnessId: "native",
    wireApi: "responses",
  },
  {
    providerId: "nodex-mock-openrouter",
    modelId: "mock-openrouter-model",
    harnessId: "native",
    wireApi: "chat",
  },
  {
    providerId: "nodex-mock-agents-namespace",
    modelId: "mock-agents-namespace-model",
    harnessId: "native",
    toolNamespace: "agents",
    waitAgentEnabled: false,
    wireApi: "responses",
  },
  {
    providerId: "nodex-mock-agents-disabled",
    modelId: "mock-agents-disabled-model",
    harnessId: "native",
    agentsEnabled: false,
    expectedMultiAgentVersion: "disabled",
    multiAgentV2FeatureEnabled: false,
    wireApi: "responses",
  },
  {
    providerId: "nodex-mock-v2-feature-overrides-disabled-agents",
    modelId: "mock-v2-feature-overrides-disabled-agents-model",
    harnessId: "native",
    agentsEnabled: false,
    expectedMultiAgentVersion: "v2",
    multiAgentV2FeatureEnabled: true,
    wireApi: "responses",
  },
  {
    providerId: "nodex-mock-v1-agents-without-v2-feature",
    modelId: "mock-v1-agents-without-v2-feature-model",
    harnessId: "native",
    agentsEnabled: true,
    collabFeatureEnabled: true,
    expectedMultiAgentVersion: "v1",
    multiAgentV2FeatureEnabled: false,
    wireApi: "responses",
  },
  {
    providerId: "nodex-mock-code-mode-nested",
    modelId: "mock-code-mode-nested-model",
    harnessId: "native",
    multiAgentPlacement: "code-mode-nested",
    wireApi: "responses",
  },
  {
    providerId: "nodex-mock-direct-model-only",
    modelId: "mock-direct-model-only-model",
    harnessId: "native",
    multiAgentPlacement: "direct-model-only",
    wireApi: "responses",
  },
  {
    providerId: "nodex-mock-kimi",
    modelId: "mock-kimi-model",
    harnessId: "kimi-code",
    wireApi: "chat",
  },
  {
    providerId: "nodex-mock-anthropic",
    modelId: "mock-claude-model",
    harnessId: "claude-code",
    wireApi: "messages",
  },
];

const persistedMultiAgentV2Case: WireCase = {
  providerId: "nodex-mock-persisted-v2",
  modelId: "mock-persisted-v2-model",
  harnessId: "native",
  ephemeral: false,
  wireApi: "responses",
};

const persistedMultiAgentV1Case: WireCase = {
  providerId: "nodex-mock-persisted-v1",
  modelId: "mock-persisted-v1-model",
  harnessId: "native",
  agentsEnabled: true,
  collabFeatureEnabled: true,
  ephemeral: false,
  expectedMultiAgentVersion: "v1",
  multiAgentV2FeatureEnabled: false,
  wireApi: "responses",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error("Wire conformance received a non-object request body");
  return parsed;
}

function sendSse(response: ServerResponse, chunks: readonly string[]): void {
  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
  });
  response.end(chunks.join(""));
}

function respondToWireRequest(wireApi: WireApi, response: ServerResponse): void {
  if (wireApi === "responses") {
    sendSse(response, [
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_nodex_wire"}}\n\n',
      `event: response.output_item.done\ndata: ${JSON.stringify({
        type: "response.output_item.done",
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: conformanceText }],
        },
      })}\n\n`,
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_nodex_wire","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
    ]);
    return;
  }

  if (wireApi === "chat") {
    sendSse(response, [
      `data: ${JSON.stringify({
        id: "chatcmpl_nodex_wire",
        object: "chat.completion.chunk",
        created: 0,
        model: "mock-chat-model",
        choices: [
          { index: 0, delta: { role: "assistant", content: conformanceText }, finish_reason: null },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: "chatcmpl_nodex_wire",
        object: "chat.completion.chunk",
        created: 0,
        model: "mock-chat-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`,
      "data: [DONE]\n\n",
    ]);
    return;
  }

  sendSse(response, [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_nodex_wire","model":"mock-claude-model","usage":{"input_tokens":1}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: conformanceText },
    })}\n\n`,
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":1}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ]);
}

function wireApiForPath(urlPath: string): WireApi | null {
  if (urlPath.endsWith("/responses")) return "responses";
  if (urlPath.endsWith("/chat/completions")) return "chat";
  if (urlPath.endsWith("/messages")) return "messages";
  return null;
}

async function startMockServer(): Promise<{
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
  readonly requests: RecordedRequest[];
}> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const urlPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const wireApi = wireApiForPath(urlPath);
      if (request.method !== "POST" || !wireApi) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end('{"error":"not found"}');
        return;
      }
      const body = await readJsonBody(request);
      const authorization = request.headers.authorization;
      requests.push({
        authorizationScheme: authorization?.split(" ", 1)[0] ?? null,
        body,
        credentialHeader: authorization
          ? "authorization"
          : typeof request.headers["x-api-key"] === "string"
            ? "x-api-key"
            : null,
        path: urlPath,
      });
      respondToWireRequest(wireApi, response);
    })().catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Mock wire server did not bind a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    requests,
  };
}

function waitForTurnCompletion(
  client: CodexProbeClient,
  threadId: string,
): Promise<{ readonly responseTextObserved: boolean }> {
  return new Promise((resolve, reject) => {
    let responseTextObserved = false;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for conformance turn on ${threadId}`));
    }, requestTimeoutMs);
    const listener = (notification: ServerNotification): void => {
      const rawParams: unknown = notification.params;
      const params = isRecord(rawParams) ? rawParams : {};
      if (params.threadId !== threadId) return;
      if (
        notification.method === "item/completed" &&
        JSON.stringify(params).includes(conformanceText)
      ) {
        responseTextObserved = true;
      }
      if (notification.method !== "turn/completed") return;
      cleanup();
      const turn = isRecord(params.turn) ? params.turn : {};
      if (turn.status !== "completed") {
        reject(
          new Error(
            `Conformance turn failed for ${threadId}: ${JSON.stringify(turn.error ?? turn)}`,
          ),
        );
        return;
      }
      resolve({ responseTextObserved });
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      client.off("notification", listener);
    };
    client.on("notification", listener);
  });
}

function requestHasTools(body: Record<string, unknown>): boolean {
  return Array.isArray(body.tools) && body.tools.length > 0;
}

function collectNamedTools(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectNamedTools(entry, names);
    return names;
  }
  if (!isRecord(value)) return names;
  if (typeof value.name === "string") names.add(value.name);
  for (const entry of Object.values(value)) collectNamedTools(entry, names);
  return names;
}

function expectedMultiAgentV2Tools(toolNamespace: string, waitAgentEnabled: boolean): string[] {
  return multiAgentV2Actions
    .filter((action) => waitAgentEnabled || action !== "wait_agent")
    .map((action) => `${toolNamespace}_${action}`);
}

function readMultiAgentV2Tools(
  body: Record<string, unknown>,
  toolNamespace: string,
  waitAgentEnabled: boolean,
): readonly string[] {
  const actualNames = [...collectNamedTools(body.tools)];
  const hasNamespace = actualNames.includes(toolNamespace);
  const requiredTools = expectedMultiAgentV2Tools(toolNamespace, waitAgentEnabled);
  const missing = requiredTools.filter((expected) => {
    if (actualNames.includes(expected)) return false;
    const actionName = expected.slice(toolNamespace.length + 1);
    return !hasNamespace || !actualNames.includes(actionName);
  });
  if (missing.length > 0) {
    throw new Error(
      `Runtime selected an incomplete MultiAgentV2 tool surface: missing ${missing.join(", ")}; observed ${actualNames.join(", ")}`,
    );
  }
  const forbiddenWaitTool = `${toolNamespace}_wait_agent`;
  if (
    !waitAgentEnabled &&
    (actualNames.includes(forbiddenWaitTool) ||
      (hasNamespace && actualNames.includes("wait_agent")))
  ) {
    throw new Error(
      `Runtime exposed ${forbiddenWaitTool} even though wait_agent_enabled=false; observed ${actualNames.join(", ")}`,
    );
  }
  return requiredTools;
}

function assertMultiAgentV2Absent(body: Record<string, unknown>, toolNamespace: string): void {
  const actualNames = [...collectNamedTools(body.tools)];
  const forbidden = [
    toolNamespace,
    ...multiAgentV2Actions.map((action) => `${toolNamespace}_${action}`),
  ].filter((name) => actualNames.includes(name));
  if (forbidden.length === 0) return;
  throw new Error(
    `Runtime exposed MultiAgentV2 tools while agents were disabled: ${forbidden.join(", ")}`,
  );
}

function readMultiAgentV1Tools(body: Record<string, unknown>): readonly string[] {
  const actualNames = [...collectNamedTools(body.tools)];
  const missing = [multiAgentV1Namespace, ...multiAgentV1Actions].filter(
    (name) => !actualNames.includes(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `Runtime selected an incomplete MultiAgentV1 tool surface: missing ${missing.join(", ")}; observed ${actualNames.join(", ")}`,
    );
  }
  return multiAgentV1Actions.map((action) => `${multiAgentV1Namespace}_${action}`);
}

function assertMultiAgentV1Absent(body: Record<string, unknown>): void {
  const actualNames = [...collectNamedTools(body.tools)];
  if (!actualNames.includes(multiAgentV1Namespace)) return;
  throw new Error(
    `Runtime exposed the ${multiAgentV1Namespace} namespace for a V1-ineligible thread`,
  );
}

function readCodeModeNestedMultiAgentV2Tools(
  body: Record<string, unknown>,
  toolNamespace: string,
  waitAgentEnabled: boolean,
): readonly string[] {
  assertMultiAgentV2Absent(body, toolNamespace);
  const actualNames = [...collectNamedTools(body.tools)];
  if (!actualNames.includes("exec")) {
    throw new Error(
      `Runtime omitted the Code Mode exec entrypoint; observed ${actualNames.join(", ")}`,
    );
  }
  const wirePrompt = JSON.stringify(body);
  const nestedTools = multiAgentV2Actions.filter(
    (action) => waitAgentEnabled || action !== "wait_agent",
  );
  const missing = nestedTools.filter((action) => !wirePrompt.includes(action));
  if (missing.length > 0) {
    throw new Error(
      `Runtime omitted nested MultiAgentV2 tools from the Code Mode wire prompt: ${missing.join(", ")}`,
    );
  }
  return nestedTools.map((action) => `${toolNamespace}_${action}`);
}

async function runWireCase(input: {
  readonly baseUrl: string;
  readonly client: CodexProbeClient;
  readonly cwd: string;
  readonly requests: RecordedRequest[];
  readonly resumeThreadId?: string;
  readonly wireCase: WireCase;
}): Promise<WireCaseResult> {
  const requestStart = input.requests.length;
  const multiAgentV2FeatureEnabled = input.wireCase.multiAgentV2FeatureEnabled ?? true;
  const expectedMultiAgentVersion =
    input.wireCase.expectedMultiAgentVersion ?? (multiAgentV2FeatureEnabled ? "v2" : "disabled");
  const multiAgentV2Effective = expectedMultiAgentVersion === "v2";
  const multiAgentPlacement = input.wireCase.multiAgentPlacement ?? "direct";
  const toolNamespace = input.wireCase.toolNamespace ?? "collaboration";
  const waitAgentEnabled = input.wireCase.waitAgentEnabled ?? true;
  const providerBaseUrl =
    input.wireCase.wireApi === "messages" ? input.baseUrl : `${input.baseUrl}/v1`;
  const providerConfig = {
    name: input.wireCase.providerId,
    base_url: providerBaseUrl,
    env_key: "NODEX_WIRE_CONFORMANCE_API_KEY",
    wire_api: input.wireCase.wireApi,
    request_max_retries: 0,
    stream_max_retries: 0,
  };
  const threadConfig = {
    [`model_providers.${input.wireCase.providerId}`]: providerConfig,
    harness: input.wireCase.harnessId,
    "features.plugins": false,
    "features.code_mode": multiAgentPlacement !== "direct",
    "features.code_mode_only": multiAgentPlacement !== "direct",
    ...(input.wireCase.collabFeatureEnabled === undefined
      ? {}
      : { "features.collab": input.wireCase.collabFeatureEnabled }),
    "agents.enabled": input.wireCase.agentsEnabled ?? true,
    "features.multi_agent_v2": {
      enabled: multiAgentV2FeatureEnabled,
      max_concurrent_threads_per_session: 4,
      min_wait_timeout_ms: 10_000,
      default_wait_timeout_ms: 30_000,
      max_wait_timeout_ms: 60_000,
      tool_namespace: toolNamespace,
      expose_spawn_agent_model_overrides: true,
      wait_agent_enabled: waitAgentEnabled,
      non_code_mode_only: multiAgentPlacement === "direct-model-only",
    },
  };
  const threadResponse = await input.client.request(
    input.resumeThreadId ? "thread/resume" : "thread/start",
    {
      ...(input.resumeThreadId
        ? { threadId: input.resumeThreadId, excludeTurns: true }
        : { ephemeral: input.wireCase.ephemeral ?? true }),
      model: input.wireCase.modelId,
      modelProvider: input.wireCase.providerId,
      cwd: input.cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      config: threadConfig,
    },
  );
  if (
    !isRecord(threadResponse) ||
    !isRecord(threadResponse.thread) ||
    typeof threadResponse.thread.id !== "string"
  ) {
    throw new Error(
      `Invalid ${input.resumeThreadId ? "thread/resume" : "thread/start"} response for ${input.wireCase.providerId}`,
    );
  }
  const threadId = threadResponse.thread.id;
  if (threadResponse.modelProvider !== input.wireCase.providerId) {
    throw new Error(
      `Runtime selected provider ${String(threadResponse.modelProvider)}; expected ${input.wireCase.providerId}`,
    );
  }

  const completion = waitForTurnCompletion(input.client, threadId);
  await input.client.request("turn/start", {
    threadId,
    input: [{ type: "text", text: `Reply exactly ${conformanceText}`, text_elements: [] }],
  });
  const result = await completion;
  const recorded = input.requests.slice(requestStart);
  if (recorded.length === 0) {
    throw new Error(
      `Expected at least one ${input.wireCase.wireApi} request for ${input.wireCase.providerId}`,
    );
  }
  const request = recorded.find((candidate) => candidate.body.model === input.wireCase.modelId);
  if (!request) throw new Error(`Missing recorded request for ${input.wireCase.providerId}`);
  const expectedPath =
    input.wireCase.wireApi === "responses"
      ? "/v1/responses"
      : input.wireCase.wireApi === "chat"
        ? "/v1/chat/completions"
        : "/v1/messages";
  const unexpectedPath = recorded.find((candidate) => candidate.path !== expectedPath);
  if (unexpectedPath) {
    throw new Error(
      `Wire request for ${input.wireCase.providerId} used unexpected endpoint ${unexpectedPath.path}`,
    );
  }
  if (!result.responseTextObserved) {
    throw new Error(
      `Runtime did not project ${input.wireCase.wireApi} response text to app-server events`,
    );
  }
  const expectedCredentialHeader =
    input.wireCase.wireApi === "messages" ? "x-api-key" : "authorization";
  if (request.credentialHeader !== expectedCredentialHeader) {
    throw new Error(
      `${input.wireCase.providerId} used credential header ${String(request.credentialHeader)}; expected ${expectedCredentialHeader}`,
    );
  }
  if (!requestHasTools(request.body)) {
    throw new Error(`${input.wireCase.providerId} omitted the Codex-compatible tool catalog`);
  }
  const multiAgentTools = (() => {
    if (input.wireCase.harnessId !== "native") return { v1: [], v2: [] };
    if (expectedMultiAgentVersion === "disabled") {
      assertMultiAgentV2Absent(request.body, toolNamespace);
      assertMultiAgentV1Absent(request.body);
      return { v1: [], v2: [] };
    }
    if (expectedMultiAgentVersion === "v1") {
      assertMultiAgentV2Absent(request.body, toolNamespace);
      return { v1: readMultiAgentV1Tools(request.body), v2: [] };
    }
    assertMultiAgentV1Absent(request.body);
    if (multiAgentPlacement === "code-mode-nested") {
      return {
        v1: [],
        v2: readCodeModeNestedMultiAgentV2Tools(request.body, toolNamespace, waitAgentEnabled),
      };
    }
    return {
      v1: [],
      v2: readMultiAgentV2Tools(request.body, toolNamespace, waitAgentEnabled),
    };
  })();
  return {
    agentsEnabled: input.wireCase.agentsEnabled ?? true,
    authorizationScheme: request.authorizationScheme,
    collabFeatureEnabled: input.wireCase.collabFeatureEnabled ?? null,
    credentialHeader: request.credentialHeader,
    harnessId: input.wireCase.harnessId,
    modelId: input.wireCase.modelId,
    multiAgentPlacement,
    multiAgentVersion:
      input.wireCase.harnessId === "native" ? expectedMultiAgentVersion : "external-harness",
    multiAgentV1Tools: multiAgentTools.v1,
    multiAgentV2Effective,
    multiAgentV2FeatureEnabled,
    multiAgentV2Tools: multiAgentTools.v2,
    path: request.path,
    providerId: input.wireCase.providerId,
    requestHasTools: requestHasTools(request.body),
    requestCount: recorded.length,
    responseTextObserved: result.responseTextObserved,
    threadId,
    toolNamespace,
    waitAgentEnabled,
    wireApi: input.wireCase.wireApi,
  };
}

function readOption(argv: string[], option: string): string | null {
  const index = argv.indexOf(option);
  if (index < 0) return null;
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

async function probeAgentRuntimeWirePromise(
  input: {
    readonly binaryPath: string;
    readonly outputPath?: string;
  },
  callbacks: ScopedCallbackRuntime["Service"],
): Promise<AgentRuntimeWireConformanceReport> {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "nodex-agent-runtime-wire-"));
  const stateHome = path.join(temporaryRoot, "home");
  const cwd = path.join(temporaryRoot, "workspace");
  mkdirSync(stateHome, { recursive: true, mode: 0o700 });
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const server = await startMockServer();
  try {
    const sessionOptions = {
      binaryPath: input.binaryPath,
      requestTimeout: requestTimeoutMs,
      expectedCodexHome: stateHome,
      env: {
        ...process.env,
        INTERPRETER_HOME: stateHome,
        NODEX_WIRE_CONFORMANCE_API_KEY: "nodex-wire-secret",
      },
      clientInfo: {
        name: "nodex-agent-runtime-wire-conformance",
        title: "Nodex Agent Runtime Wire Conformance",
        version: "1.0.0",
      },
    } as const;
    const initial = await callbacks.runPromise(
      withCodexProbeSession(callbacks, sessionOptions, async (client) => {
        const results: WireCaseResult[] = [];
        for (const wireCase of wireCases) {
          results.push(
            await runWireCase({
              baseUrl: server.baseUrl,
              client,
              cwd,
              requests: server.requests,
              wireCase,
            }),
          );
        }
        const persistedV2 = await runWireCase({
          baseUrl: server.baseUrl,
          client,
          cwd,
          requests: server.requests,
          wireCase: persistedMultiAgentV2Case,
        });
        const persistedV1 = await runWireCase({
          baseUrl: server.baseUrl,
          client,
          cwd,
          requests: server.requests,
          wireCase: persistedMultiAgentV1Case,
        });
        return { persistedV1, persistedV2, results };
      }),
    );
    const resumed = await callbacks.runPromise(
      withCodexProbeSession(callbacks, sessionOptions, async (client) => {
        const v2 = await runWireCase({
          baseUrl: server.baseUrl,
          client,
          cwd,
          requests: server.requests,
          resumeThreadId: initial.persistedV2.threadId,
          wireCase: {
            ...persistedMultiAgentV2Case,
            expectedMultiAgentVersion: "v2",
            multiAgentV2FeatureEnabled: false,
          },
        });
        const v1 = await runWireCase({
          baseUrl: server.baseUrl,
          client,
          cwd,
          requests: server.requests,
          resumeThreadId: initial.persistedV1.threadId,
          wireCase: {
            ...persistedMultiAgentV1Case,
            // A persisted V1 selector must survive even when no current feature would choose V1.
            collabFeatureEnabled: false,
          },
        });
        return { v1, v2 };
      }),
    );
    const cases = [
      ...initial.results,
      initial.persistedV2,
      initial.persistedV1,
      resumed.v2,
      resumed.v1,
    ];
    const report: AgentRuntimeWireConformanceReport = {
      binaryPath: path.resolve(input.binaryPath),
      cases,
      generatedAt: new Date().toISOString(),
      isolatedPerThreadConfig: "pass",
      multiAgentDirectModelAndCodeModeSelection: "pass",
      multiAgentV2ToolSelection: "pass",
      nativeSelectionMatrix: "pass",
      persistedLegacyV1ResumeSelection: "pass",
      persistedResumeSelection: "pass",
    };
    if (input.outputPath) {
      mkdirSync(path.dirname(input.outputPath), { recursive: true });
      writeFileSync(input.outputPath, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    }
    return report;
  } finally {
    await server.close();
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: temporaryRootCleanupRetries,
      retryDelay: temporaryRootCleanupRetryDelayMs,
    });
  }
}

export const probeAgentRuntimeWire = (input: {
  readonly binaryPath: string;
  readonly outputPath?: string;
}): Effect.Effect<AgentRuntimeWireConformanceReport, Cause.UnknownError, ScopedCallbackRuntime> =>
  Effect.gen(function* () {
    const callbacks = yield* ScopedCallbackRuntime;
    return yield* Effect.tryPromise(() => probeAgentRuntimeWirePromise(input, callbacks));
  });

const main = Effect.gen(function* () {
  const argv = process.argv.slice(2);
  const runtime = resolveCodexRuntime({ isPackaged: false, projectRootPath: projectRoot });
  const binaryPath = path.resolve(readOption(argv, "--binary") ?? runtime.binaryPath);
  const outputPath = path.resolve(
    readOption(argv, "--out") ??
      path.join(projectRoot, ".generated", "agent-runtime-conformance", "wire.json"),
  );
  const report = yield* probeAgentRuntimeWire({ binaryPath, outputPath });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCodexProbeMain(main);
}
