import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerNotification } from "@nodex/codex-app-server-protocol";
import { CodexAppServerClient } from "../src/main/codex/codex-app-server-client";
import { resolveCodexRuntime } from "../src/main/codex/codex-runtime";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const conformanceText = "NODEX_WIRE_CONFORMANCE_OK";
const requestTimeoutMs = 30_000;

type WireApi = "responses" | "chat" | "messages";

type WireCase = {
  readonly harnessId: "native" | "kimi-code" | "claude-code";
  readonly modelId: string;
  readonly providerId: string;
  readonly wireApi: WireApi;
};

type RecordedRequest = {
  readonly authorizationScheme: string | null;
  readonly body: Record<string, unknown>;
  readonly credentialHeader: "authorization" | "x-api-key" | null;
  readonly path: string;
};

type WireCaseResult = {
  readonly authorizationScheme: string | null;
  readonly credentialHeader: "authorization" | "x-api-key" | null;
  readonly harnessId: WireCase["harnessId"];
  readonly modelId: string;
  readonly path: string;
  readonly providerId: string;
  readonly requestHasTools: boolean;
  readonly requestCount: number;
  readonly responseTextObserved: boolean;
  readonly wireApi: WireApi;
};

export type AgentRuntimeWireConformanceReport = {
  readonly binaryPath: string;
  readonly cases: WireCaseResult[];
  readonly generatedAt: string;
  readonly isolatedPerThreadConfig: "pass";
};

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
        choices: [{ index: 0, delta: { role: "assistant", content: conformanceText }, finish_reason: null }],
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
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock wire server did not bind a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
    requests,
  };
}

function waitForTurnCompletion(
  client: CodexAppServerClient,
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
        notification.method === "item/completed"
        && JSON.stringify(params).includes(conformanceText)
      ) {
        responseTextObserved = true;
      }
      if (notification.method !== "turn/completed") return;
      cleanup();
      const turn = isRecord(params.turn) ? params.turn : {};
      if (turn.status !== "completed") {
        reject(new Error(`Conformance turn failed for ${threadId}: ${JSON.stringify(turn.error ?? turn)}`));
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

async function runWireCase(input: {
  readonly baseUrl: string;
  readonly client: CodexAppServerClient;
  readonly cwd: string;
  readonly requests: RecordedRequest[];
  readonly wireCase: WireCase;
}): Promise<WireCaseResult> {
  const requestStart = input.requests.length;
  const providerBaseUrl = input.wireCase.wireApi === "messages"
    ? input.baseUrl
    : `${input.baseUrl}/v1`;
  const providerConfig = {
    name: input.wireCase.providerId,
    base_url: providerBaseUrl,
    env_key: "NODEX_WIRE_CONFORMANCE_API_KEY",
    wire_api: input.wireCase.wireApi,
    request_max_retries: 0,
    stream_max_retries: 0,
  };
  const startResponse = await input.client.request<unknown>("thread/start", {
    model: input.wireCase.modelId,
    modelProvider: input.wireCase.providerId,
    cwd: input.cwd,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    ephemeral: true,
    config: {
      [`model_providers.${input.wireCase.providerId}`]: providerConfig,
      harness: input.wireCase.harnessId,
      "features.plugins": false,
    },
  });
  if (!isRecord(startResponse) || !isRecord(startResponse.thread) || typeof startResponse.thread.id !== "string") {
    throw new Error(`Invalid thread/start response for ${input.wireCase.providerId}`);
  }
  const threadId = startResponse.thread.id;
  if (startResponse.modelProvider !== input.wireCase.providerId) {
    throw new Error(
      `Runtime selected provider ${String(startResponse.modelProvider)}; expected ${input.wireCase.providerId}`,
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
  const expectedPath = input.wireCase.wireApi === "responses"
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
    throw new Error(`Runtime did not project ${input.wireCase.wireApi} response text to app-server events`);
  }
  const expectedCredentialHeader = input.wireCase.wireApi === "messages"
    ? "x-api-key"
    : "authorization";
  if (request.credentialHeader !== expectedCredentialHeader) {
    throw new Error(
      `${input.wireCase.providerId} used credential header ${String(request.credentialHeader)}; expected ${expectedCredentialHeader}`,
    );
  }
  if (!requestHasTools(request.body)) {
    throw new Error(`${input.wireCase.providerId} omitted the Codex-compatible tool catalog`);
  }
  return {
    authorizationScheme: request.authorizationScheme,
    credentialHeader: request.credentialHeader,
    harnessId: input.wireCase.harnessId,
    modelId: input.wireCase.modelId,
    path: request.path,
    providerId: input.wireCase.providerId,
    requestHasTools: requestHasTools(request.body),
    requestCount: recorded.length,
    responseTextObserved: result.responseTextObserved,
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

export async function probeAgentRuntimeWire(input: {
  readonly binaryPath: string;
  readonly outputPath?: string;
}): Promise<AgentRuntimeWireConformanceReport> {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "nodex-agent-runtime-wire-"));
  const stateHome = path.join(temporaryRoot, "home");
  const cwd = path.join(temporaryRoot, "workspace");
  mkdirSync(stateHome, { recursive: true, mode: 0o700 });
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const server = await startMockServer();
  const client = new CodexAppServerClient({
    binaryPath: input.binaryPath,
    logStderr: false,
    requestTimeoutMs,
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
  });

  try {
    await client.start();
    const cases: WireCaseResult[] = [];
    for (const wireCase of wireCases) {
      cases.push(await runWireCase({
        baseUrl: server.baseUrl,
        client,
        cwd,
        requests: server.requests,
        wireCase,
      }));
    }
    const report: AgentRuntimeWireConformanceReport = {
      binaryPath: path.resolve(input.binaryPath),
      cases,
      generatedAt: new Date().toISOString(),
      isolatedPerThreadConfig: "pass",
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
    await client.stop();
    await server.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const runtime = resolveCodexRuntime({ isPackaged: false, projectRootPath: projectRoot });
  const binaryPath = path.resolve(readOption(argv, "--binary") ?? runtime.binaryPath);
  const outputPath = path.resolve(
    readOption(argv, "--out")
      ?? path.join(projectRoot, ".generated", "agent-runtime-conformance", "wire.json"),
  );
  const report = await probeAgentRuntimeWire({ binaryPath, outputPath });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
