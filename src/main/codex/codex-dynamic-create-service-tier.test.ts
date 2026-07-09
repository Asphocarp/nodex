import { describe, expect, test } from "vitest";
import {
  type CodexCreateThreadServiceTierDependencies,
  type CodexCreateThreadServiceTierModel,
  resolveCodexCreateThreadServiceTier,
} from "./codex-dynamic-create-service-tier";

function model(input: {
  readonly id: string;
  readonly model?: string;
  readonly isDefault?: boolean;
  readonly defaultServiceTier?: string | null;
  readonly serviceTiers?: readonly { readonly id: string; readonly name: string }[];
}): CodexCreateThreadServiceTierModel {
  return {
    id: input.id,
    model: input.model ?? input.id,
    isDefault: input.isDefault ?? false,
    defaultServiceTier: input.defaultServiceTier ?? null,
    serviceTiers: input.serviceTiers ?? [],
  };
}

function createDependencies(overrides: Partial<CodexCreateThreadServiceTierDependencies> = {}):
CodexCreateThreadServiceTierDependencies {
  return {
    readAuth: async () => "chatgpt",
    readRequirements: async () => ({ requirements: null }),
    readConfig: async () => ({ model: null, service_tier: null }),
    listModels: async () => ({ data: [] }),
    ...overrides,
  };
}

const destination = {
  destinationHostId: "destination",
  destinationCwd: "/destination/repo",
  model: null,
} as const;

describe("Codex dynamic create-thread service-tier resolution", () => {
  test("uses the destination host-global configured service tier", async () => {
    const calls: unknown[] = [];
    const resolved = await resolveCodexCreateThreadServiceTier(destination, createDependencies({
      readAuth: async (input) => {
        calls.push(["auth", input]);
        return "chatgpt";
      },
      readRequirements: async (input) => {
        calls.push(["requirements", input]);
        return { requirements: null };
      },
      readConfig: async (input) => {
        calls.push(["config", input]);
        return { model: "config-model", service_tier: "ultrafast" };
      },
      listModels: async (input) => {
        calls.push(["models", input]);
        return { data: [] };
      },
    }));

    expect(resolved).toBe("ultrafast");
    expect(JSON.stringify(calls)).toBe(JSON.stringify([
      ["auth", { hostId: "destination" }],
      ["requirements", { hostId: "destination" }],
      ["config", { hostId: "destination", cwd: null, includeLayers: false }],
    ]));
  });

  test("profile-expands the host-global config before selecting its tier and model", async () => {
    const resolved = await resolveCodexCreateThreadServiceTier(destination, createDependencies({
      readConfig: async () => ({
        profile: "delegated",
        model: "base-model",
        service_tier: null,
        profiles: {
          delegated: {
            model: "profile-model",
            service_tier: "priority",
          },
        },
      }),
      listModels: async () => {
        throw new Error("an explicit profile tier must not read models");
      },
    }));

    expect(resolved).toBe("priority");
  });

  test("resolves an unconfigured tier from requested, configured, then default model selection", async () => {
    const catalog = [
      model({
        id: "requested-id",
        model: "requested-model",
        defaultServiceTier: "fast",
        serviceTiers: [{ id: "priority", name: "Priority" }],
      }),
      model({
        id: "configured-id",
        model: "configured-model",
        defaultServiceTier: "flex",
        serviceTiers: [{ id: "flex", name: "Flex" }],
      }),
      model({
        id: "default-id",
        isDefault: true,
        defaultServiceTier: "ultrafast",
        serviceTiers: [{ id: "ultrafast", name: "UltraFast" }],
      }),
    ];
    const deps = createDependencies({
      readConfig: async () => ({ model: "configured-model", service_tier: null }),
      listModels: async () => ({ data: catalog }),
    });

    expect(await resolveCodexCreateThreadServiceTier({
      ...destination,
      model: "requested-model",
    }, deps)).toBe("priority");
    expect(await resolveCodexCreateThreadServiceTier(destination, deps)).toBe("flex");
    expect(await resolveCodexCreateThreadServiceTier(destination, createDependencies({
      readConfig: async () => ({ model: null, service_tier: null }),
      listModels: async () => ({ data: catalog }),
    }))).toBe("ultrafast");
  });

  test("matches model ids and rejects catalog defaults that do not resolve to an advertised tier", async () => {
    const byId = await resolveCodexCreateThreadServiceTier({
      ...destination,
      model: "catalog-id",
    }, createDependencies({
      listModels: async () => ({
        data: [model({
          id: "catalog-id",
          model: "model-slug",
          defaultServiceTier: "fast",
          serviceTiers: [{ id: "speed", name: "Fast" }],
        })],
      }),
    }));
    const unavailable = await resolveCodexCreateThreadServiceTier(destination, createDependencies({
      listModels: async () => ({
        data: [model({
          id: "default",
          isDefault: true,
          defaultServiceTier: "fast",
          serviceTiers: [],
        })],
      }),
    }));

    expect(byId).toBe("speed");
    expect(unavailable).toBe(null);
  });

  test("models exact from-config, standard, and custom selector branches", async () => {
    let configReads = 0;
    let modelReads = 0;
    const deps = createDependencies({
      readConfig: async () => {
        configReads += 1;
        return { service_tier: "from-config" };
      },
      listModels: async () => {
        modelReads += 1;
        return { data: [] };
      },
    });

    expect(await resolveCodexCreateThreadServiceTier(destination, deps)).toBe("from-config");
    expect(await resolveCodexCreateThreadServiceTier({
      ...destination,
      selector: { type: "standard" },
    }, deps)).toBe(null);
    expect(await resolveCodexCreateThreadServiceTier({
      ...destination,
      selector: { type: "custom", serviceTier: "priority" },
    }, deps)).toBe("priority");
    expect(await resolveCodexCreateThreadServiceTier({
      ...destination,
      selector: { type: "custom", serviceTier: "default" },
    }, deps)).toBe(null);
    expect(configReads).toBe(1);
    expect(modelReads).toBe(0);
  });

  test("enables tiers only for ChatGPT auth when fast_mode is not explicitly false", async () => {
    let nonChatGptRequirementsReads = 0;
    const nonChatGpt = await resolveCodexCreateThreadServiceTier({
      ...destination,
      selector: { type: "custom", serviceTier: "priority" },
    }, createDependencies({
      readAuth: async () => "apikey",
      readRequirements: async () => {
        nonChatGptRequirementsReads += 1;
        return { requirements: null };
      },
    }));
    const disabled = await resolveCodexCreateThreadServiceTier({
      ...destination,
      selector: { type: "custom", serviceTier: "priority" },
    }, createDependencies({
      readRequirements: async () => ({
        requirements: { featureRequirements: { fast_mode: false } },
      }),
    }));
    const unspecified = await resolveCodexCreateThreadServiceTier({
      ...destination,
      selector: { type: "custom", serviceTier: "priority" },
    }, createDependencies({
      readRequirements: async () => ({
        requirements: { featureRequirements: {} },
      }),
    }));

    expect(nonChatGpt).toBe(null);
    expect(nonChatGptRequirementsReads).toBe(0);
    expect(disabled).toBe(null);
    expect(unspecified).toBe("priority");
  });

  test("retains exact from-config reads behind a disabled gate and fails closed on reads", async () => {
    const calls: string[] = [];
    const gated = await resolveCodexCreateThreadServiceTier(destination, createDependencies({
      readRequirements: async () => ({
        requirements: { featureRequirements: { fast_mode: false } },
      }),
      readConfig: async () => {
        calls.push("config");
        return { model: "default", service_tier: null };
      },
      listModels: async () => {
        calls.push("models");
        return {
          data: [model({
            id: "default",
            isDefault: true,
            defaultServiceTier: "fast",
            serviceTiers: [{ id: "fast", name: "Fast" }],
          })],
        };
      },
    }));
    const phases: string[] = [];
    const configFailure = await resolveCodexCreateThreadServiceTier(destination, createDependencies({
      readConfig: async () => {
        throw new Error("config unavailable");
      },
      onError: ({ phase }) => phases.push(phase),
    }));
    const modelFailure = await resolveCodexCreateThreadServiceTier(destination, createDependencies({
      listModels: async () => {
        throw new Error("models unavailable");
      },
      onError: ({ phase }) => phases.push(phase),
    }));
    const requirementsFailure = await resolveCodexCreateThreadServiceTier(destination, createDependencies({
      readRequirements: async () => {
        throw new Error("requirements unavailable");
      },
      onError: ({ phase }) => phases.push(phase),
    }));

    expect(gated).toBe(null);
    expect(JSON.stringify(calls)).toBe(JSON.stringify(["config", "models"]));
    expect(configFailure).toBe(null);
    expect(modelFailure).toBe(null);
    expect(requirementsFailure).toBe(null);
    expect(JSON.stringify(phases)).toBe(JSON.stringify(["request", "models", "request"]));
  });
});
