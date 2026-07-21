import { describe, expect, test } from "vitest";
import type { AgentProviderCatalog } from "../../shared/agent-runtime";
import {
  discoverAgentProviderCatalog,
  resolveAgentExecutionProfileFromCatalog,
  resolveAgentHarnessId,
  type AgentProviderCatalogClient,
} from "./agent-provider-catalog";

function model(id: string, effort: string) {
  return {
    id,
    model: id,
    displayName: id,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: effort, description: "" }],
    defaultReasoningEffort: effort,
    inputModalities: ["text"],
    isDefault: true,
  };
}

describe("agent provider catalog", () => {
  test("keeps duplicate model ids provider-scoped and preserves Kimi effort case", async () => {
    const client: AgentProviderCatalogClient = {
      async request(method, params) {
        if (method === "interpreter/provider/list") {
          return { data: [
            { id: "anthropic", name: "Anthropic", description: "", isCurrent: false, wireApi: "messages", envKey: "ANTHROPIC_API_KEY", configured: true, isDefault: false },
            { id: "kimi-for-coding", name: "Kimi For Coding", description: "", isCurrent: false, wireApi: "chat", envKey: "KIMI_API_KEY", configured: true, isDefault: false },
            { id: "unsupported", name: "Unsupported", description: "", isCurrent: false, wireApi: "chat", configured: true, isDefault: false },
          ] };
        }
        if (method === "interpreter/model/list") {
          const providerId = (params as { modelProvider: string }).modelProvider;
          return { data: [model("shared/model", providerId === "kimi-for-coding" ? "Thinking" : "high")] };
        }
        if (method === "interpreter/harness/list") {
          const providerId = (params as { providerId: string }).providerId;
          return { data: [{ id: providerId === "anthropic" ? "claude-code" : "kimi-code", label: "Harness", description: "", isRecommended: true }] };
        }
        throw new Error(`Unexpected method ${method}`);
      },
    };

    const catalog = await discoverAgentProviderCatalog({
      client,
      credentialStatusReader: { status: async () => "missing" },
    });

    expect(catalog.providers.map((provider) => provider.id)).toEqual([
      "anthropic",
      "kimi-for-coding",
    ]);
    expect(catalog.providers[0]?.models[0]?.providerId).toBe("anthropic");
    expect(catalog.providers[1]?.models[0]?.providerId).toBe("kimi-for-coding");
    expect(catalog.providers[1]?.models[0]?.defaultReasoningEffort).toBe("Thinking");
    expect(catalog.providers[1]?.models[0]?.supportedReasoningEfforts[0]?.value).toBe("Thinking");
  });

  test("resolves the runtime-recommended harness for the exact model", async () => {
    const calls: unknown[] = [];
    const harnessId = await resolveAgentHarnessId({
      client: {
        async request(method, params) {
          calls.push({ method, params });
          return { data: [
            { label: "Native", description: "", isRecommended: false },
            { id: "claude-code", label: "Claude Code", description: "", isRecommended: true },
          ] };
        },
      },
      providerId: "openrouter",
      modelId: "~anthropic/claude-fable-latest",
      requestedHarnessId: null,
      fallbackHarnessId: null,
    });

    expect(harnessId).toBe("claude-code");
    expect(calls).toEqual([{
      method: "interpreter/harness/list",
      params: { providerId: "openrouter", model: "~anthropic/claude-fable-latest" },
    }]);
  });

  test("uses the exact model recommendation and falls back when the runtime has none", async () => {
    const responses = [
      { data: [
        { id: null, label: "Native", description: "", isRecommended: false },
        { id: "kimi-code", label: "Kimi Code", description: "", isRecommended: true },
      ] },
      { data: [
        { id: null, label: "Native", description: "", isRecommended: false },
        { id: "kimi-code", label: "Kimi Code", description: "", isRecommended: false },
      ] },
    ];
    const client: AgentProviderCatalogClient = {
      async request() {
        const response = responses.shift();
        if (!response) throw new Error("Unexpected harness request");
        return response;
      },
    };

    await expect(resolveAgentHarnessId({
      client,
      providerId: "openrouter",
      modelId: "moonshotai/kimi-k3",
      requestedHarnessId: null,
      fallbackHarnessId: null,
    })).resolves.toBe("kimi-code");
    await expect(resolveAgentHarnessId({
      client,
      providerId: "openrouter",
      modelId: "~anthropic/claude-fable-latest",
      requestedHarnessId: null,
      fallbackHarnessId: null,
    })).resolves.toBeNull();
  });

  test("rejects a harness that the exact provider/model pair does not expose", async () => {
    await expect(resolveAgentHarnessId({
      client: {
        async request() {
          return { data: [
            { id: null, label: "Native", description: "", isRecommended: true },
          ] };
        },
      },
      providerId: "openrouter",
      modelId: "~anthropic/claude-fable-latest",
      requestedHarnessId: "kimi-code",
      fallbackHarnessId: null,
    })).rejects.toThrow("Agent harness 'kimi-code' is unavailable");
  });

  test("validates the full profile and resolves a model-specific harness", async () => {
    const catalog: AgentProviderCatalog = {
      providers: [{
        id: "openrouter",
        displayName: "OpenRouter",
        description: null,
        wireApi: "chat",
        credentialStatus: "ready",
        supportedByNodex: true,
        isDefault: false,
        credentialEnvKey: "OPENROUTER_API_KEY",
        recommendedHarnessId: null,
        models: [{
          providerId: "openrouter",
          modelId: "moonshotai/kimi-k3",
          displayName: "Kimi K3",
          description: null,
          hidden: false,
          isDefault: true,
          recommendedHarnessId: null,
          supportedReasoningEfforts: [{ value: "Thinking", description: null }],
          defaultReasoningEffort: "Thinking",
          inputCapabilities: ["text"],
          switchPolicy: "new-thread",
        }],
      }],
    };
    const client: AgentProviderCatalogClient = {
      async request() {
        return { data: [
          { id: null, label: "Native", description: "", isRecommended: false },
          { id: "kimi-code", label: "Kimi Code", description: "", isRecommended: true },
        ] };
      },
    };

    await expect(resolveAgentExecutionProfileFromCatalog({
      client,
      catalog,
      requested: {
        providerId: "openrouter",
        modelId: "moonshotai/kimi-k3",
        harnessId: null,
        reasoningEffort: null,
        serviceTier: null,
      },
    })).resolves.toEqual({
      providerId: "openrouter",
      modelId: "moonshotai/kimi-k3",
      harnessId: "kimi-code",
      reasoningEffort: "Thinking",
      serviceTier: null,
    });

    await expect(resolveAgentExecutionProfileFromCatalog({
      client,
      catalog,
      requested: {
        providerId: "openrouter",
        modelId: "moonshotai/kimi-k3",
        harnessId: null,
        reasoningEffort: "unsupported",
        serviceTier: null,
      },
    })).rejects.toThrow("Reasoning effort 'unsupported' is unavailable");
    await expect(resolveAgentExecutionProfileFromCatalog({
      client,
      catalog,
      requested: {
        providerId: "openrouter",
        modelId: "moonshotai/kimi-k3",
        harnessId: null,
        reasoningEffort: "Thinking",
        serviceTier: "fast",
      },
    })).rejects.toThrow("Service tier is unsupported");

    const provider = catalog.providers[0];
    const catalogWithUnlistedRuntimeDefault: AgentProviderCatalog = {
      providers: provider ? [{
        ...provider,
        models: provider.models.map((candidate) => ({
          ...candidate,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "medium",
        })),
      }] : [],
    };
    await expect(resolveAgentExecutionProfileFromCatalog({
      client,
      catalog: catalogWithUnlistedRuntimeDefault,
      requested: {
        providerId: "openrouter",
        modelId: "moonshotai/kimi-k3",
        harnessId: null,
        reasoningEffort: null,
        serviceTier: null,
      },
    })).resolves.toMatchObject({ reasoningEffort: null });
  });
});
