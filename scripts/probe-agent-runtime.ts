import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient, CodexRpcError } from "../src/main/codex/codex-app-server-client";
import { resolveCodexRuntime } from "../src/main/codex/codex-runtime";
import {
  readOpenInterpreterReleaseLock,
  resolveOpenInterpreterReleaseLockPath,
} from "./agent-runtime-release-lock";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

type JsonObject = Record<string, unknown>;

type ProviderSummary = {
  configuredClaim: boolean | null;
  envKey: string | null;
  harnesses: Array<{ id: string | null; recommended: boolean }>;
  id: string;
  modelCount: number;
  modelIds: string[];
  name: string;
  wireApi: string | null;
};

type ModelHarnessSummary = {
  providerId: string;
  modelId: string;
  recommendedHarnessId: string;
};

export type AgentRuntimeConformanceReport = {
  binaryPath: string;
  capabilities: {
    gracefulShutdown: "pass";
    initialize: "pass";
    invalidMethod: "pass";
    modelHarnessRouting: "pass";
    providerCatalog: "pass";
    schemaFingerprint: "pass";
    threadSearchColdRestart: "pass";
  };
  codexCompatibilityVersion: string;
  generatedAt: string;
  initialize: {
    codexHome: string;
    platformFamily: string;
    platformOs: string;
    userAgent: string;
  };
  lockTag: string;
  modelHarnesses: ModelHarnessSummary[];
  protocolSchemaSha256: string;
  providers: ProviderSummary[];
  runtimeVersion: string;
  threadSearch: {
    firstResultCount: number;
    restartedResultCount: number;
  };
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): JsonObject {
  if (isObject(value)) return value;
  throw new Error(`Agent runtime conformance expected ${label} to be an object`);
}

function requireArray(value: unknown, label: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(`Agent runtime conformance expected ${label} to be an array`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Agent runtime conformance expected ${label} to be a non-empty string`);
}

function listFiles(rootPath: string, currentPath = rootPath): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(rootPath, entryPath));
      continue;
    }
    if (!entry.isFile()) throw new Error(`Schema generator emitted a non-file entry: ${entryPath}`);
    files.push(entryPath);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function readFingerprintContent(filePath: string): Buffer {
  if (path.extname(filePath) !== ".json") return readFileSync(filePath);
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  return Buffer.from(JSON.stringify(sortJsonValue(parsed)), "utf8");
}

export function fingerprintGeneratedSchemas(rootPath: string): string {
  const hash = createHash("sha256");
  for (const filePath of listFiles(rootPath)) {
    hash.update(path.relative(rootPath, filePath).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(readFingerprintContent(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function generateSchemaFingerprint(binaryPath: string): string {
  const schemaRoot = mkdtempSync(path.join(os.tmpdir(), "nodex-agent-runtime-schema-"));
  try {
    execFileSync(
      binaryPath,
      ["app-server", "generate-ts", "--experimental", "--out", path.join(schemaRoot, "ts")],
      { stdio: "pipe" },
    );
    execFileSync(
      binaryPath,
      [
        "app-server",
        "generate-json-schema",
        "--experimental",
        "--out",
        path.join(schemaRoot, "json"),
      ],
      { stdio: "pipe" },
    );
    return fingerprintGeneratedSchemas(schemaRoot);
  } finally {
    rmSync(schemaRoot, { recursive: true, force: true });
  }
}

function readResultData(value: unknown, label: string): unknown[] {
  return requireArray(requireObject(value, label).data, `${label}.data`);
}

function summarizeHarnesses(value: unknown): ProviderSummary["harnesses"] {
  return readResultData(value, "interpreter/harness/list response").map((entry, index) => {
    const harness = requireObject(entry, `harness[${index}]`);
    return {
      id: typeof harness.id === "string" ? harness.id : null,
      recommended: harness.isRecommended === true,
    };
  });
}

function summarizeModelIds(value: unknown): string[] {
  return readResultData(value, "interpreter/model/list response").map((entry, index) => {
    const model = requireObject(entry, `model[${index}]`);
    return requireString(model.id, `model[${index}].id`);
  });
}

function readSearchCount(value: unknown): number {
  const response = requireObject(value, "thread/search response");
  const data = requireArray(response.data, "thread/search response.data");
  if (response.nextCursor !== null && typeof response.nextCursor !== "string") {
    throw new Error("Agent runtime conformance found an invalid thread/search nextCursor");
  }
  return data.length;
}

async function createProbeClient(
  binaryPath: string,
  stateHome: string,
): Promise<CodexAppServerClient> {
  const client = new CodexAppServerClient({
    binaryPath,
    logStderr: false,
    env: {
      ...process.env,
      INTERPRETER_HOME: stateHome,
    },
    clientInfo: {
      name: "nodex-agent-runtime-conformance",
      title: "Nodex Agent Runtime Conformance",
      version: "1.0.0",
    },
  });
  await client.start();
  return client;
}

export async function probeAgentRuntime(input: {
  binaryPath: string;
  stateHome: string;
}): Promise<AgentRuntimeConformanceReport> {
  const lock = readOpenInterpreterReleaseLock(resolveOpenInterpreterReleaseLockPath(projectRoot));
  const requestedStateHome = path.resolve(input.stateHome);
  mkdirSync(requestedStateHome, { recursive: true, mode: 0o700 });
  const expectedStateHome = realpathSync(requestedStateHome);
  const versionOutput = execFileSync(input.binaryPath, ["--version"], { encoding: "utf8" }).trim();
  if (!versionOutput.includes(lock.runtimeVersion)) {
    throw new Error(
      `Agent runtime version ${versionOutput} does not match release lock ${lock.runtimeVersion}`,
    );
  }
  const protocolSchemaSha256 = generateSchemaFingerprint(input.binaryPath);
  if (protocolSchemaSha256 !== lock.protocolSchemaSha256) {
    throw new Error(
      `Agent runtime schema fingerprint ${protocolSchemaSha256} does not match release lock ${lock.protocolSchemaSha256}`,
    );
  }

  const client = await createProbeClient(input.binaryPath, expectedStateHome);
  let initialize;
  let providers: ProviderSummary[] = [];
  let modelHarnesses: ModelHarnessSummary[] = [];
  let firstResultCount = 0;
  try {
    initialize = client.getInitializeResponse();
    if (!initialize) throw new Error("Agent runtime did not retain its initialize response");
    if (path.resolve(initialize.codexHome) !== expectedStateHome) {
      throw new Error(
        `Agent runtime initialized with ${initialize.codexHome}; expected isolated home ${expectedStateHome}`,
      );
    }

    const providerEntries = readResultData(
      await client.request<unknown>("interpreter/provider/list", { includeUnconfigured: true }),
      "interpreter/provider/list response",
    );
    const requiredProviderIds = new Set([
      "openai",
      "anthropic",
      "kimi-for-coding",
      "moonshotai",
      "openrouter",
    ]);
    const supportedProviderEntries = providerEntries.filter((entry, index) => {
      const provider = requireObject(entry, `provider[${index}]`);
      return requiredProviderIds.has(requireString(provider.id, `provider[${index}].id`));
    });
    providers = await Promise.all(
      supportedProviderEntries.map(async (entry, index): Promise<ProviderSummary> => {
        const provider = requireObject(entry, `provider[${index}]`);
        const id = requireString(provider.id, `provider[${index}].id`);
        const name = requireString(provider.name, `provider[${index}].name`);
        const modelIds = summarizeModelIds(
          await client.request<unknown>("interpreter/model/list", {
            modelProvider: id,
            includeHidden: false,
          }),
        );
        const harnesses = summarizeHarnesses(
          await client.request<unknown>("interpreter/harness/list", {
            providerId: id,
            model: modelIds[0] ?? null,
          }),
        );
        return {
          configuredClaim: typeof provider.configured === "boolean" ? provider.configured : null,
          envKey: typeof provider.envKey === "string" ? provider.envKey : null,
          harnesses,
          id,
          modelCount: modelIds.length,
          modelIds: modelIds.slice(0, 20),
          name,
          wireApi: typeof provider.wireApi === "string" ? provider.wireApi : null,
        };
      }),
    );

    for (const requiredProviderId of requiredProviderIds) {
      if (!providers.some((provider) => provider.id === requiredProviderId)) {
        throw new Error(
          `Agent runtime provider catalog omits required provider ${requiredProviderId}`,
        );
      }
    }

    const requiredModelHarnesses = [
      { providerId: "anthropic", modelId: "claude-fable-5", recommendedHarnessId: "claude-code" },
      { providerId: "kimi-for-coding", modelId: "k3", recommendedHarnessId: "kimi-code" },
      { providerId: "moonshotai", modelId: "kimi-k3", recommendedHarnessId: "kimi-code" },
      {
        providerId: "openrouter",
        modelId: "moonshotai/kimi-k2.7-code",
        recommendedHarnessId: "kimi-code",
      },
    ] as const;
    modelHarnesses = await Promise.all(
      requiredModelHarnesses.map(async (expected) => {
        const harnesses = summarizeHarnesses(
          await client.request<unknown>("interpreter/harness/list", {
            providerId: expected.providerId,
            model: expected.modelId,
          }),
        );
        const recommended = harnesses.find((harness) => harness.recommended);
        if (recommended?.id !== expected.recommendedHarnessId) {
          throw new Error(
            `Agent runtime recommended harness ${recommended?.id ?? "<none>"} for ${expected.providerId}/${expected.modelId}; expected ${expected.recommendedHarnessId}`,
          );
        }
        return { ...expected };
      }),
    );

    firstResultCount = readSearchCount(
      await client.request<unknown>("thread/search", {
        searchTerm: "nodex-conformance-no-match",
        limit: 2,
        archived: false,
      }),
    );
    try {
      await client.request("nodex/conformance/invalid-method", {});
      throw new Error("Agent runtime accepted the conformance invalid method");
    } catch (error) {
      if (!(error instanceof CodexRpcError) || error.code !== -32600) throw error;
    }
  } finally {
    await client.stop();
  }

  const restartedClient = await createProbeClient(input.binaryPath, expectedStateHome);
  let restartedResultCount = 0;
  try {
    restartedResultCount = readSearchCount(
      await restartedClient.request<unknown>("thread/search", {
        searchTerm: "nodex-conformance-no-match",
        limit: 2,
        archived: false,
      }),
    );
  } finally {
    await restartedClient.stop();
  }

  if (!initialize) throw new Error("Agent runtime initialize response was unavailable");
  return {
    binaryPath: path.resolve(input.binaryPath),
    capabilities: {
      gracefulShutdown: "pass",
      initialize: "pass",
      invalidMethod: "pass",
      modelHarnessRouting: "pass",
      providerCatalog: "pass",
      schemaFingerprint: "pass",
      threadSearchColdRestart: "pass",
    },
    codexCompatibilityVersion: lock.codexCompatibilityVersion,
    generatedAt: new Date().toISOString(),
    initialize: {
      codexHome: initialize.codexHome,
      platformFamily: initialize.platformFamily,
      platformOs: initialize.platformOs,
      userAgent: initialize.userAgent,
    },
    lockTag: lock.release.tag,
    modelHarnesses,
    protocolSchemaSha256,
    providers,
    runtimeVersion: lock.runtimeVersion,
    threadSearch: { firstResultCount, restartedResultCount },
  };
}

function readOption(argv: string[], option: string): string | null {
  const index = argv.indexOf(option);
  if (index < 0) return null;
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const stagedRuntime = resolveCodexRuntime({ isPackaged: false, projectRootPath: projectRoot });
  const binaryPath = path.resolve(readOption(argv, "--binary") ?? stagedRuntime.binaryPath);
  const explicitStateHome = readOption(argv, "--state-home");
  const temporaryRoot = explicitStateHome
    ? null
    : mkdtempSync(path.join(os.tmpdir(), "nodex-agent-runtime-conformance-"));
  const stateHome = path.resolve(explicitStateHome ?? path.join(temporaryRoot!, "home"));
  const outputPath = path.resolve(
    readOption(argv, "--out") ??
      path.join(projectRoot, ".generated", "agent-runtime-conformance", "latest.json"),
  );

  try {
    const report = await probeAgentRuntime({ binaryPath, stateHome });
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const stats = statSync(outputPath);
    if ((stats.mode & 0o077) !== 0)
      throw new Error(`Conformance report permissions are too broad: ${outputPath}`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
