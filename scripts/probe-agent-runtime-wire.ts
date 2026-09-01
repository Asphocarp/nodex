import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { V2TurnCompletedNotification } from "@nodex/effect-codex-app-server/schema";
import type { ServerNotification } from "@nodex/codex-app-server-protocol";
import { ScopedCallbackRuntime } from "../src/main/app/ScopedCallbackRuntime";
import { resolveCodexRuntime } from "../src/main/codex/codex-runtime";
import {
  type CodexProbeClient,
  runCodexProbeMain,
  withCodexProbeSession,
} from "./codex-probe-session";
import {
  responses,
  type ScriptedModelHttpResponse,
  type ScriptedModelProviderConfig,
  type ScriptedModelRequest,
  scriptedModelResponse,
  withScriptedModelServer,
} from "./scenarios/runtime/scripted-model-server";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const conformanceText = "NODEX_WIRE_CONFORMANCE_OK";
const toolConformancePrompt = "NODEX_WIRE_TOOL_ROUND_TRIP";
const toolConformanceCallId = "call_nodex_wire_tool_round_trip";
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
  readonly responsesWebSockets?: boolean;
  readonly toolNamespace?: string;
  readonly toolRoundTrip?: boolean;
  readonly waitAgentEnabled?: boolean;
  readonly wireApi: WireApi;
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
  readonly transport: "http" | "websocket";
  readonly toolRoundTrip: boolean;
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
    providerId: "nodex-mock-responses-websocket",
    modelId: "mock-responses-websocket-model",
    harnessId: "native",
    responsesWebSockets: true,
    toolRoundTrip: true,
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

function respondToWireRequest(wireApi: WireApi): ScriptedModelHttpResponse {
  if (wireApi === "responses") {
    return responses.stream([
      responses.created("resp_nodex_wire"),
      responses.assistantMessage("message_nodex_wire", conformanceText),
      responses.completed("resp_nodex_wire"),
    ]);
  }

  if (wireApi === "chat") {
    return scriptedModelResponse.sse([
      {
        data: {
          id: "chatcmpl_nodex_wire",
          object: "chat.completion.chunk",
          created: 0,
          model: "mock-chat-model",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: conformanceText },
              finish_reason: null,
            },
          ],
        },
      },
      {
        data: {
          id: "chatcmpl_nodex_wire",
          object: "chat.completion.chunk",
          created: 0,
          model: "mock-chat-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        },
      },
      { data: "[DONE]" },
    ]);
  }

  return scriptedModelResponse.sse([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: { id: "msg_nodex_wire", model: "mock-claude-model", usage: { input_tokens: 1 } },
      },
    },
    {
      event: "content_block_start",
      data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: conformanceText },
      },
    },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    { event: "message_delta", data: { type: "message_delta", usage: { output_tokens: 1 } } },
    { event: "message_stop", data: { type: "message_stop" } },
  ]);
}

function wireApiForPath(urlPath: string): WireApi | null {
  if (urlPath.endsWith("/responses")) return "responses";
  if (urlPath.endsWith("/chat/completions")) return "chat";
  if (urlPath.endsWith("/messages")) return "messages";
  return null;
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
      try {
        Schema.decodeUnknownSync(V2TurnCompletedNotification)(params);
      } catch (error) {
        reject(
          new Error(`Generated turn/completed schema rejected runtime payload`, { cause: error }),
        );
        return;
      }
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
  readonly client: CodexProbeClient;
  readonly cwd: string;
  readonly providerConfig: (providerId: string, wireApi: WireApi) => ScriptedModelProviderConfig;
  readonly requests: () => readonly ScriptedModelRequest[];
  readonly resumeThreadId?: string;
  readonly wireCase: WireCase;
}): Promise<WireCaseResult> {
  const requestStart = input.requests().length;
  const multiAgentV2FeatureEnabled = input.wireCase.multiAgentV2FeatureEnabled ?? true;
  const expectedMultiAgentVersion =
    input.wireCase.expectedMultiAgentVersion ?? (multiAgentV2FeatureEnabled ? "v2" : "disabled");
  const multiAgentV2Effective = expectedMultiAgentVersion === "v2";
  const multiAgentPlacement = input.wireCase.multiAgentPlacement ?? "direct";
  const toolNamespace = input.wireCase.toolNamespace ?? "collaboration";
  const waitAgentEnabled = input.wireCase.waitAgentEnabled ?? true;
  const providerConfig = {
    ...input.providerConfig(input.wireCase.providerId, input.wireCase.wireApi),
    env_key: "NODEX_WIRE_CONFORMANCE_API_KEY",
    supports_websockets: input.wireCase.responsesWebSockets ?? false,
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
    input: [
      {
        type: "text",
        text: input.wireCase.toolRoundTrip
          ? toolConformancePrompt
          : `Reply exactly ${conformanceText}`,
        text_elements: [],
      },
    ],
  });
  const result = await completion;
  const recorded = input.requests().slice(requestStart);
  if (recorded.length === 0) {
    throw new Error(
      `Expected at least one ${input.wireCase.wireApi} request for ${input.wireCase.providerId}`,
    );
  }
  const generationRequests = recorded.filter((candidate) => candidate.isGenerationRequest());
  const request = generationRequests.find(
    (candidate) => candidate.body.model === input.wireCase.modelId,
  );
  if (!request) throw new Error(`Missing recorded request for ${input.wireCase.providerId}`);
  const expectedGenerationMethod = input.wireCase.responsesWebSockets ? "WEBSOCKET" : "POST";
  const wrongTransport = generationRequests.find(
    (candidate) => candidate.method !== expectedGenerationMethod,
  );
  if (wrongTransport) {
    throw new Error(
      `${input.wireCase.providerId} generated over ${wrongTransport.method}; expected ${expectedGenerationMethod}`,
    );
  }
  const prewarmRequests = recorded.filter((candidate) => !candidate.isGenerationRequest());
  if (input.wireCase.responsesWebSockets) {
    if (
      prewarmRequests.length !== 1 ||
      prewarmRequests[0]?.method !== "WEBSOCKET" ||
      generationRequests.some(
        (candidate) => candidate.connectionId !== prewarmRequests[0]?.connectionId,
      )
    ) {
      throw new Error(
        `${input.wireCase.providerId} did not generate on its single prewarmed WebSocket connection`,
      );
    }
  } else if (prewarmRequests.length > 0) {
    throw new Error(`${input.wireCase.providerId} unexpectedly issued a prewarm request`);
  }
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
  const credentialHeader = request.header("authorization")
    ? "authorization"
    : request.header("x-api-key")
      ? "x-api-key"
      : null;
  if (credentialHeader !== expectedCredentialHeader) {
    throw new Error(
      `${input.wireCase.providerId} used credential header ${String(credentialHeader)}; expected ${expectedCredentialHeader}`,
    );
  }
  const assertedBody = { ...request.body, tools: request.effectiveTools() };
  if (!requestHasTools(assertedBody)) {
    throw new Error(`${input.wireCase.providerId} omitted the Codex-compatible tool catalog`);
  }
  const multiAgentTools = (() => {
    if (input.wireCase.harnessId !== "native") return { v1: [], v2: [] };
    if (expectedMultiAgentVersion === "disabled") {
      assertMultiAgentV2Absent(assertedBody, toolNamespace);
      assertMultiAgentV1Absent(assertedBody);
      return { v1: [], v2: [] };
    }
    if (expectedMultiAgentVersion === "v1") {
      assertMultiAgentV2Absent(assertedBody, toolNamespace);
      return { v1: readMultiAgentV1Tools(assertedBody), v2: [] };
    }
    assertMultiAgentV1Absent(assertedBody);
    if (multiAgentPlacement === "code-mode-nested") {
      return {
        v1: [],
        v2: readCodeModeNestedMultiAgentV2Tools(assertedBody, toolNamespace, waitAgentEnabled),
      };
    }
    return {
      v1: [],
      v2: readMultiAgentV2Tools(assertedBody, toolNamespace, waitAgentEnabled),
    };
  })();
  return {
    agentsEnabled: input.wireCase.agentsEnabled ?? true,
    authorizationScheme: request.header("authorization")?.split(" ", 1)[0] ?? null,
    collabFeatureEnabled: input.wireCase.collabFeatureEnabled ?? null,
    credentialHeader,
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
    requestHasTools: requestHasTools(assertedBody),
    requestCount: recorded.length,
    responseTextObserved: result.responseTextObserved,
    transport: expectedGenerationMethod === "WEBSOCKET" ? "websocket" : "http",
    toolRoundTrip: input.wireCase.toolRoundTrip ?? false,
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
  try {
    return await withScriptedModelServer(
      {
        exchanges: [
          {
            name: "wire conformance response",
            expectedCalls:
              wireCases.length + wireCases.filter((wireCase) => wireCase.toolRoundTrip).length + 4,
            // Some provider adapters make a capability/preflight request. The semantic
            // assertions below own the exact requests that matter; keep only a narrow
            // transport-level ceiling here so adapter plumbing does not make the probe brittle.
            maximumCalls:
              wireCases.length + wireCases.filter((wireCase) => wireCase.toolRoundTrip).length + 6,
            match: (request) => wireApiForPath(request.path) !== null,
            respond: (request) => {
              const wireApi = wireApiForPath(request.path);
              if (!wireApi) throw new Error(`Unsupported wire path ${request.path}`);
              if (request.hasFunctionCallOutput(toolConformanceCallId)) {
                const output = request.functionCallOutput(toolConformanceCallId);
                if (!JSON.stringify(output).includes("NODEX_WIRE_TOOL_OK")) {
                  throw new Error("Agent runtime tool output omitted NODEX_WIRE_TOOL_OK");
                }
                return responses.stream([
                  responses.created("resp_nodex_wire_tool_final"),
                  responses.assistantMessage("message_nodex_wire_tool", conformanceText),
                  responses.completed("resp_nodex_wire_tool_final"),
                ]);
              }
              if (request.hasInputText(toolConformancePrompt)) {
                return responses.stream([
                  responses.created("resp_nodex_wire_tool"),
                  responses.functionCall(toolConformanceCallId, "exec_command", {
                    cmd: "printf NODEX_WIRE_TOOL_OK",
                    yield_time_ms: 10_000,
                  }),
                  responses.completed("resp_nodex_wire_tool"),
                ]);
              }
              return respondToWireRequest(wireApi);
            },
          },
        ],
      },
      async (server) => {
        const sessionOptions = {
          binaryPath: input.binaryPath,
          requestTimeout: requestTimeoutMs,
          expectedCodexHome: stateHome,
          env: {
            ...process.env,
            ...server.loopbackEnvironment(),
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
                  client,
                  cwd,
                  providerConfig: (providerId, wireApi) =>
                    server.providerConfig(providerId, wireApi),
                  requests: () => server.requests(),
                  wireCase,
                }),
              );
            }
            const persistedV2 = await runWireCase({
              client,
              cwd,
              providerConfig: (providerId, wireApi) => server.providerConfig(providerId, wireApi),
              requests: () => server.requests(),
              wireCase: persistedMultiAgentV2Case,
            });
            const persistedV1 = await runWireCase({
              client,
              cwd,
              providerConfig: (providerId, wireApi) => server.providerConfig(providerId, wireApi),
              requests: () => server.requests(),
              wireCase: persistedMultiAgentV1Case,
            });
            return { persistedV1, persistedV2, results };
          }),
        );
        const resumed = await callbacks.runPromise(
          withCodexProbeSession(callbacks, sessionOptions, async (client) => {
            const v2 = await runWireCase({
              client,
              cwd,
              providerConfig: (providerId, wireApi) => server.providerConfig(providerId, wireApi),
              requests: () => server.requests(),
              resumeThreadId: initial.persistedV2.threadId,
              wireCase: {
                ...persistedMultiAgentV2Case,
                expectedMultiAgentVersion: "v2",
                multiAgentV2FeatureEnabled: false,
              },
            });
            const v1 = await runWireCase({
              client,
              cwd,
              providerConfig: (providerId, wireApi) => server.providerConfig(providerId, wireApi),
              requests: () => server.requests(),
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
      },
    );
  } finally {
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
