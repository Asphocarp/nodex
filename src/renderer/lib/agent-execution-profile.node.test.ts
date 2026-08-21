import { describe, expect, test } from "vitest";
import type { AgentProviderCatalog } from "../../shared/agent-runtime";
import {
  parseStoredAgentExecutionProfile,
  resolveAgentExecutionProfile,
  resolveEffectiveAgentExecutionProfile,
  selectAgentModel,
  selectAgentReasoningEffort,
  selectAgentProvider,
} from "./agent-execution-profile";

const CATALOG: AgentProviderCatalog = {
  providers: [
    {
      id: "openai",
      displayName: "OpenAI",
      description: null,
      wireApi: "responses",
      credentialStatus: "runtimeManaged",
      supportedByNodex: true,
      isDefault: true,
      credentialEnvKey: null,
      recommendedHarnessId: null,
      models: [
        {
          providerId: "openai",
          modelId: "gpt-5.5",
          displayName: "GPT-5.5",
          description: null,
          hidden: false,
          isDefault: true,
          recommendedHarnessId: null,
          supportedReasoningEfforts: [{ value: "high", displayName: "High", description: null }],
          defaultReasoningEffort: "high",
          supportedServiceTiers: [
            { value: null, displayName: "Standard", description: null },
            { value: "fast", displayName: "Fast", description: null },
          ],
          defaultServiceTier: null,
          inputCapabilities: ["text", "image"],
          switchPolicy: "same-thread",
        },
      ],
    },
    {
      id: "kimi-for-coding",
      displayName: "Kimi For Coding",
      description: null,
      wireApi: "chat",
      credentialStatus: "ready",
      supportedByNodex: true,
      isDefault: false,
      credentialEnvKey: "KIMI_API_KEY",
      recommendedHarnessId: "kimi-code",
      models: [
        {
          providerId: "kimi-for-coding",
          modelId: "kimi-k3",
          displayName: "Kimi K3",
          description: null,
          hidden: false,
          isDefault: true,
          recommendedHarnessId: "kimi-code",
          supportedReasoningEfforts: [
            { value: "Thinking", displayName: "Thinking", description: null },
            { value: "Instant", displayName: "Instant", description: null },
          ],
          defaultReasoningEffort: "Thinking",
          supportedServiceTiers: [
            { value: null, displayName: "Standard", description: null },
            { value: "priority", displayName: "Priority", description: null },
          ],
          defaultServiceTier: null,
          inputCapabilities: ["text"],
          switchPolicy: "new-thread",
        },
      ],
    },
  ],
};

describe("agent execution profile selection", () => {
  test("uses a valid stored provider/model identity and preserves opaque effort case", () => {
    const profile = resolveAgentExecutionProfile({
      catalog: CATALOG,
      storedProfile: {
        providerId: "kimi-for-coding",
        modelId: "kimi-k3",
        harnessId: "stale-harness",
        reasoningEffort: "Thinking",
        serviceTier: "fast",
      },
    });

    expect(profile).toEqual({
      providerId: "kimi-for-coding",
      modelId: "kimi-k3",
      harnessId: "kimi-code",
      reasoningEffort: "Thinking",
      serviceTier: null,
    });
  });

  test("falls back atomically and rejects unsupported effort changes", () => {
    const initial = resolveAgentExecutionProfile({
      catalog: CATALOG,
      storedProfile: {
        providerId: "removed",
        modelId: "removed",
        harnessId: null,
        reasoningEffort: null,
        serviceTier: null,
      },
      legacyModelId: "gpt-5.5",
      legacyReasoningEffort: "high",
      serviceTier: "fast",
    });
    expect(initial?.providerId).toBe("openai");
    expect(initial?.serviceTier).toBe("fast");

    const kimi = selectAgentProvider(CATALOG, "kimi-for-coding", initial);
    expect(kimi?.reasoningEffort).toBe("Thinking");
    expect(kimi?.serviceTier).toBeNull();
    expect(kimi && selectAgentReasoningEffort(CATALOG, kimi, "unsupported")).toBeNull();
    expect(kimi && selectAgentReasoningEffort(CATALOG, kimi, "Instant")?.reasoningEffort).toBe(
      "Instant",
    );

    const openaiModel = CATALOG.providers[0]?.models[0];
    expect(openaiModel && selectAgentModel(openaiModel, kimi).reasoningEffort).toBe("high");
  });

  test("preserves model-advertised service tiers without provider-specific branching", () => {
    const profile = resolveAgentExecutionProfile({
      catalog: CATALOG,
      storedProfile: {
        providerId: "kimi-for-coding",
        modelId: "kimi-k3",
        harnessId: "kimi-code",
        reasoningEffort: "Thinking",
        serviceTier: "priority",
      },
    });

    expect(profile?.serviceTier).toBe("priority");
    expect(profile && selectAgentProvider(CATALOG, "kimi-for-coding", profile)?.serviceTier).toBe(
      "priority",
    );
  });

  test("maps the semantic Fast preference to the model-advertised wire tier", () => {
    const catalog: AgentProviderCatalog = {
      providers: CATALOG.providers.map((provider) =>
        provider.id !== "openai"
          ? provider
          : {
              ...provider,
              models: provider.models.map((model) => ({
                ...model,
                supportedServiceTiers: [
                  { value: null, displayName: "Standard", description: null },
                  { value: "priority", displayName: "Fast", description: null },
                ],
                defaultServiceTier: "fast",
              })),
            },
      ),
    };

    const profile = resolveAgentExecutionProfile({
      catalog,
      legacyModelId: "gpt-5.5",
      legacyReasoningEffort: "high",
      serviceTier: "fast",
    });

    expect(profile?.serviceTier).toBe("priority");
    expect(
      resolveAgentExecutionProfile({
        catalog,
        legacyModelId: "gpt-5.5",
        legacyReasoningEffort: "high",
      })?.serviceTier,
    ).toBe("priority");
  });

  test("preserves the task harness when changing intelligence within one provider", () => {
    const kimiModel = CATALOG.providers[1]?.models[0];
    const current = {
      providerId: "kimi-for-coding",
      modelId: "kimi-k3",
      harnessId: "custom-kimi-harness",
      reasoningEffort: "Thinking",
      serviceTier: null,
    };

    expect(kimiModel && selectAgentModel(kimiModel, current).harnessId).toBe("custom-kimi-harness");
  });

  test("projects active-thread intelligence without borrowing the global draft", () => {
    const draftProfile = {
      providerId: "kimi-for-coding",
      modelId: "kimi-k3",
      harnessId: "kimi-code",
      reasoningEffort: "Thinking",
      serviceTier: null,
    };
    const legacyThread = resolveEffectiveAgentExecutionProfile({
      catalog: CATALOG,
      activeThreadId: "thread_legacy",
      threadProfile: null,
      threadModelProvider: "openai",
      liveModel: "gpt-5.5",
      liveReasoningEffort: "high",
      liveServiceTier: "fast",
      draftProfile,
    });

    expect(legacyThread).toEqual({
      providerId: "openai",
      modelId: "gpt-5.5",
      harnessId: null,
      reasoningEffort: "high",
      serviceTier: "fast",
    });
    expect(
      resolveEffectiveAgentExecutionProfile({
        catalog: CATALOG,
        activeThreadId: "thread_unknown",
        threadProfile: null,
        threadModelProvider: "removed",
        liveModel: "gpt-5.5",
        liveReasoningEffort: "high",
        liveServiceTier: null,
        draftProfile,
      }),
    ).toBeNull();
    expect(
      resolveEffectiveAgentExecutionProfile({
        catalog: CATALOG,
        activeThreadId: null,
        threadProfile: null,
        threadModelProvider: null,
        liveModel: null,
        liveReasoningEffort: null,
        liveServiceTier: undefined,
        draftProfile,
      }),
    ).toEqual(draftProfile);
  });

  test("treats an explicit standard tier as an override for a stored fast tier", () => {
    const profile = resolveAgentExecutionProfile({
      catalog: CATALOG,
      storedProfile: {
        providerId: "openai",
        modelId: "gpt-5.5",
        harnessId: null,
        reasoningEffort: "high",
        serviceTier: "fast",
      },
      serviceTier: null,
    });

    expect(profile?.serviceTier).toBeNull();
  });

  test("fails closed for malformed persisted values", () => {
    expect(
      parseStoredAgentExecutionProfile({
        providerId: "anthropic",
        modelId: "claude\u0000opus",
        harnessId: null,
        reasoningEffort: null,
        serviceTier: null,
      }),
    ).toBeNull();
  });
});
