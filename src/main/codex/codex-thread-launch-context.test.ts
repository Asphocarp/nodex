import { describe, expect, test } from "vitest";
import type { ConfigRequirementsReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigRequirementsReadResponse";
import {
  buildCodexNewConversationParams,
  loadCodexDynamicToolsWithTimeout,
  mergeCodexDefaultFeatureOverrides,
  parseCodexStoredShellEnvironment,
  resolveCodexLaunchServiceTier,
  type CodexThreadLaunchContextDependencies,
} from "./codex-thread-launch-context";

const noRequirements: ConfigRequirementsReadResponse = { requirements: null };

function createDependencies(
  overrides: Partial<CodexThreadLaunchContextDependencies> = {},
): CodexThreadLaunchContextDependencies {
  return {
    readConfigRequirements: async () => noRequirements,
    buildMcpCodexConfig: async () => null,
    loadDynamicTools: async () => [],
    resolveDeveloperInstructions: async () => "Desktop instructions",
    ...overrides,
  };
}

describe("Codex thread launch context", () => {
  test("keeps Nodex-owned live transcript capabilities enabled after config merges", () => {
    const params = mergeCodexDefaultFeatureOverrides({
      config: {
        "features.apply_patch_streaming_events": false,
        "features.thread_tools": false,
      },
    }, {
      apply_patch_streaming_events: true,
      thread_tools: true,
    });

    expect(params.config).toMatchObject({
      "features.apply_patch_streaming_events": true,
      "features.thread_tools": true,
    });
  });

  test("gates service tier on exact config requirements and fails closed", async () => {
    let errorCount = 0;
    const disabled = await resolveCodexLaunchServiceTier("fast", {
      readConfigRequirements: async () => ({
        requirements: {
          allowedApprovalPolicies: null,
          allowedApprovalsReviewers: null,
          allowedSandboxModes: null,
          allowedWindowsSandboxImplementations: null,
          allowedPermissionProfiles: null,
          defaultPermissions: null,
          allowedWebSearchModes: null,
          allowManagedHooksOnly: null,
          allowAppshots: null,
          allowRemoteControl: null,
          browserUse: null,
          checkForUpdateOnStartup: null,
          computerUse: null,
          feedback: null,
          featureRequirements: { fast_mode: false },
          hooks: null,
          enforceResidency: null,
          network: null,
          models: null,
          sqliteHome: null,
          logDir: null,
          modelCatalogJson: null,
          allowLoginShell: null,
          windowsSandboxPrivateDesktop: null,
        },
      }),
    });
    const failed = await resolveCodexLaunchServiceTier("fast", {
      readConfigRequirements: async () => {
        throw new Error("requirements unavailable");
      },
      onConfigRequirementsError: () => {
        errorCount += 1;
      },
    });
    const retained = await resolveCodexLaunchServiceTier("fast", {
      readConfigRequirements: async () => noRequirements,
    });

    expect(disabled).toBe(null);
    expect(failed).toBe(null);
    expect(retained).toBe("fast");
    expect(errorCount).toBe(1);
  });

  test("builds explicit base fields in exact stage order and keeps MCP config authoritative", async () => {
    const order: string[] = [];
    const params = await buildCodexNewConversationParams({
      model: "gpt-test",
      serviceTier: "fast",
      cwd: "/workspace",
      permissions: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "workspace-write",
      },
      defaultFeatureOverrides: {
        apply_patch_streaming_events: true,
        thread_tools: true,
        writing_blocks: true,
      },
      personality: null,
      additionalDeveloperInstructions: "Additional instructions",
    }, createDependencies({
      readConfigRequirements: async () => {
        order.push("requirements");
        return noRequirements;
      },
      resolveModelProviderConfig: async () => {
        order.push("provider");
        return {
          modelProvider: "proxy",
          config: { collision: "provider", provider_only: true },
        };
      },
      buildMcpCodexConfig: async () => {
        order.push("mcp");
        return { collision: "mcp", mcp_only: true };
      },
      readWorktreeShellEnvironment: async () => {
        order.push("shell");
        return null;
      },
      loadDynamicTools: async () => {
        order.push("dynamic");
        return [];
      },
      resolveDeveloperInstructions: async (input) => {
        order.push("developer");
        expect(input.threadToolsEnabled).toBe(true);
        expect(input.model).toBe("gpt-test");
        return "Desktop instructions";
      },
    }));

    expect(order.join(",")).toBe("requirements,provider,mcp,shell,dynamic,developer");
    expect(params.modelProvider).toBe("proxy");
    expect(params.serviceTier).toBe("fast");
    expect(params.ephemeral).toBe(null);
    expect(params.baseInstructions).toBe(null);
    expect(params.threadSource).toBe("user");
    expect(params.mockExperimentalField).toBe(null);
    expect(params.experimentalRawEvents).toBe(false);
    expect(Array.isArray(params.dynamicTools)).toBe(true);
    expect(params.config?.collision).toBe("mcp");
    expect(params.config?.provider_only).toBe(true);
    expect(params.config?.mcp_only).toBe(true);
    expect(params.config?.["features.apply_patch_streaming_events"]).toBe(true);
    expect(params.config?.["features.thread_tools"]).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(
      params.config ?? {},
      "features.writing_blocks",
    )).toBe(false);
    expect(params.developerInstructions).toBe(
      "Desktop instructions\n\nAdditional instructions",
    );
  });

  test("projects a provider profile into one thread without mutating global runtime config", async () => {
    let requirementsRead = false;
    const params = await buildCodexNewConversationParams({
      model: "legacy-model",
      executionProfile: {
        providerId: "anthropic",
        modelId: "claude-opus-4-1",
        harnessId: "fable",
        reasoningEffort: "Thinking",
        serviceTier: "priority",
      },
      serviceTier: "fast",
      cwd: "/workspace",
      permissions: null,
      defaultFeatureOverrides: null,
      personality: null,
      includeDeveloperInstructions: false,
      skipDynamicTools: true,
    }, createDependencies({
      readConfigRequirements: async () => {
        requirementsRead = true;
        return noRequirements;
      },
      resolveModelProviderConfig: async () => ({
        modelProvider: "global-provider",
        config: { provider_only: true, harness: "global-harness" },
      }),
      buildMcpCodexConfig: async () => ({ mcp_only: true }),
    }));

    expect(requirementsRead).toBe(false);
    expect(params.model).toBe("claude-opus-4-1");
    expect(params.modelProvider).toBe("anthropic");
    expect(params.serviceTier).toBe("priority");
    expect(params.config).toMatchObject({
      provider_only: true,
      mcp_only: true,
      harness: "fable",
      model_reasoning_effort: "Thinking",
    });
  });

  test("merges a persisted worktree environment over the effective shell policy", async () => {
    const params = await buildCodexNewConversationParams({
      model: null,
      serviceTier: null,
      cwd: "/worktree",
      permissions: { approvalPolicy: "on-request" },
      defaultFeatureOverrides: null,
      personality: null,
      includeDeveloperInstructions: false,
      skipDynamicTools: true,
    }, createDependencies({
      readWorktreeShellEnvironment: async () => ({
        version: 1,
        set: { SET: "new", REMOVE: "restored" },
        exclude: ["REMOVE", "STALE"],
      }),
      readEffectiveConfig: async () => ({
        shell_environment_policy: {
          inherit: "core",
          set: { REMOVE: "old", KEEP: "yes" },
          exclude: ["BASE"],
        },
      }),
    }));

    expect(params.config?.["shell_environment_policy.inherit"]).toBe("core");
    expect(JSON.stringify(params.config?.["shell_environment_policy.set"])).toBe(
      JSON.stringify({ KEEP: "yes", SET: "new", REMOVE: "restored" }),
    );
    expect(JSON.stringify(params.config?.["shell_environment_policy.exclude"])).toBe(
      JSON.stringify(["BASE", "STALE"]),
    );
    expect(Object.prototype.hasOwnProperty.call(
      params.config ?? {},
      "shell_environment_policy",
    )).toBe(false);
  });

  test("enables request_permissions_tool only for default or granular permissions", async () => {
    const build = (permissions: Parameters<typeof buildCodexNewConversationParams>[0]["permissions"]) =>
      buildCodexNewConversationParams({
        model: null,
        serviceTier: null,
        cwd: "/workspace",
        permissions,
        defaultFeatureOverrides: null,
        personality: null,
        includeDeveloperInstructions: false,
        skipDynamicTools: true,
      }, createDependencies());
    const appServerDefault = await build(null);
    const granular = await build({
      approvalPolicy: {
        granular: {
          sandbox_approval: true,
          rules: true,
          skill_approval: true,
          request_permissions: true,
          mcp_elicitations: true,
        },
      },
    });
    const ordinary = await build({ approvalPolicy: "on-request" });

    expect(appServerDefault.config?.["features.request_permissions_tool"]).toBe(true);
    expect(granular.config?.["features.request_permissions_tool"]).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(
      ordinary.config ?? {},
      "features.request_permissions_tool",
    )).toBe(false);
  });

  test("times out dynamic-tool loading to an empty list", async () => {
    let timeoutMs = 0;
    const tools = await loadCodexDynamicToolsWithTimeout(
      () => new Promise(() => {}),
      {
        scheduleTimeout: (callback, requestedTimeoutMs) => {
          timeoutMs = requestedTimeoutMs;
          callback();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        },
      },
    );

    expect(timeoutMs).toBe(5_000);
    expect(tools.length).toBe(0);
  });

  test("rejects malformed persisted shell environment payloads", () => {
    expect(parseCodexStoredShellEnvironment({
      version: 1,
      set: { VALID: "yes", INVALID: 1 },
      exclude: [],
    })).toBe(null);
    expect(parseCodexStoredShellEnvironment({
      version: 1,
      set: {},
      exclude: ["A", 1],
    })).toBe(null);
    expect(parseCodexStoredShellEnvironment({
      version: 1,
      set: { VALID: "yes" },
      exclude: ["A"],
    })?.set.VALID).toBe("yes");
  });
});
