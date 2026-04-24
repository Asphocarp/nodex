import { describe, expect, test } from "bun:test";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import type { ConfigRequirements } from "@nodex/codex-app-server-protocol/v2/ConfigRequirements";
import {
  buildPermissionModeConfigEdits,
  resolveCodexPermissionState,
} from "./codex-permission-resolver";

function buildConfig(
  overrides?: Partial<ConfigReadResponse["config"]>,
): ConfigReadResponse["config"] {
  return {
    model: null,
    review_model: null,
    model_context_window: null,
    model_auto_compact_token_limit: null,
    model_provider: null,
    approval_policy: "on-request",
    approvals_reviewer: "user",
    sandbox_mode: "workspace-write",
    sandbox_workspace_write: null,
    forced_chatgpt_workspace_id: null,
    forced_login_method: null,
    web_search: null,
    tools: null,
    profile: null,
    profiles: {},
    instructions: null,
    developer_instructions: null,
    compact_prompt: null,
    model_reasoning_effort: null,
    model_reasoning_summary: null,
    model_verbosity: null,
    service_tier: null,
    analytics: null,
    apps: null,
    features: {
      guardian_approval: true,
    },
    ...overrides,
  } as ConfigReadResponse["config"];
}

function buildRequirements(
  overrides?: Partial<ConfigRequirements>,
): ConfigRequirements {
  return {
    allowedApprovalPolicies: null,
    allowedApprovalsReviewers: null,
    allowedSandboxModes: null,
    allowedWebSearchModes: null,
    featureRequirements: null,
    hooks: null,
    enforceResidency: null,
    network: null,
    ...overrides,
  };
}

function resolveState(input: {
  config?: Partial<ConfigReadResponse["config"]>;
  requirements?: ConfigRequirements | null;
}) {
  return resolveCodexPermissionState({
    config: buildConfig(input.config),
    origins: {},
    requirements: input.requirements ?? null,
    defaultUserConfigPath: "/Users/test/.codex/config.toml",
    workspacePath: "/Users/test/project",
  });
}

describe("codex-permission-resolver", () => {
  test("writes the canonical auto_review reviewer for Auto-review", () => {
    const edits = buildPermissionModeConfigEdits("guardian-approvals");
    const reviewerEdit = edits.find((edit) => edit.keyPath === "approvals_reviewer");

    expect(reviewerEdit?.value).toBe("auto_review");
  });

  test("filters Auto-review when requirements disallow its reviewer", () => {
    const state = resolveState({
      config: {
        approvals_reviewer: "auto_review",
      },
      requirements: buildRequirements({
        allowedApprovalsReviewers: ["user"],
      }),
    });

    expect(state.availableModes.includes("guardian-approvals")).toBeFalse();
    expect(state.mode).toBe("auto");
    expect(state.effectivePreset).toBe("auto");
    expect(state.approvalsReviewer).toBe("user");
  });

  test("allows Auto-review when requirements allow automatic review", () => {
    const state = resolveState({
      config: {
        approvals_reviewer: "auto_review",
      },
      requirements: buildRequirements({
        allowedApprovalsReviewers: ["auto_review"],
      }),
    });

    expect(state.availableModes.includes("guardian-approvals")).toBeTrue();
    expect(state.availableModes.includes("auto")).toBeFalse();
    expect(state.mode).toBe("guardian-approvals");
    expect(state.effectivePreset).toBe("guardian-approvals");
    expect(state.approvalsReviewer).toBe("auto_review");
  });
});
