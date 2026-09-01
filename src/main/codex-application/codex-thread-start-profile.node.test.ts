import { describe, expect, test } from "vitest";
import type { AgentExecutionProfile } from "../../shared/agent-runtime";
import { requireExactThreadStartProfile } from "./codex-thread-start-profile";

const profile: AgentExecutionProfile = {
  providerId: "openai",
  modelId: "gpt-5.6-luna",
  harnessId: "codex",
  reasoningEffort: "max",
  serviceTier: null,
};

const response = (overrides: Record<string, unknown> = {}) =>
  ({
    thread: { id: "thread-a" },
    model: profile.modelId,
    modelProvider: profile.providerId,
    reasoningEffort: profile.reasoningEffort,
    serviceTier: profile.serviceTier,
    ...overrides,
  }) as never;

describe("Thread start execution profiles", () => {
  test("accepts the exact provider response", () => {
    expect(() => requireExactThreadStartProfile(response(), profile)).not.toThrow();
  });

  test("rejects provider fallback before first-Turn admission", () => {
    expect(() =>
      requireExactThreadStartProfile(response({ model: "gpt-5.6-sol" }), profile),
    ).toThrow("modelId");
  });

  test("leaves legacy scalar launches unchanged", () => {
    expect(() =>
      requireExactThreadStartProfile(response({ model: "fallback" }), null),
    ).not.toThrow();
  });
});
