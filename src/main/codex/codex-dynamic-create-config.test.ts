import { describe, expect, test } from "vitest";
import type { Config } from "@nodex/codex-app-server-protocol/v2/Config";
import { expandCodexDynamicCreateConfigProfile } from "./codex-dynamic-create-config";

describe("dynamic create config snapshot", () => {
  test("overlays only non-null selected-profile values", () => {
    const config = {
      profile: "delegated",
      model: "base-model",
      approval_policy: "on-request",
      approvals_reviewer: "user",
      profiles: {
        delegated: {
          model: "profile-model",
          approval_policy: null,
          approvals_reviewer: undefined,
          service_tier: "fast",
        },
      },
    } as unknown as Config;

    const expanded = expandCodexDynamicCreateConfigProfile(config) as unknown as Record<
      string,
      unknown
    >;
    expect(expanded.model).toBe("profile-model");
    expect(expanded.approval_policy).toBe("on-request");
    expect(expanded.approvals_reviewer).toBe("user");
    expect(expanded.service_tier).toBe("fast");
  });

  test("preserves identity without a valid selected profile", () => {
    const config = { model: "base-model" } as unknown as Config;
    expect(expandCodexDynamicCreateConfigProfile(config) === config).toBe(true);
  });
});
