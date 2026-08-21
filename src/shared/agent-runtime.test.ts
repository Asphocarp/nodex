import { describe, expect, test } from "vite-plus/test";
import { decodeAgentModelKey, encodeAgentModelKey } from "./agent-runtime";

describe("agent model compound identity", () => {
  test("round-trips provider and model ids without delimiter assumptions", () => {
    const key = encodeAgentModelKey("openrouter:edge", "anthropic/claude:latest");
    expect(decodeAgentModelKey(key)).toEqual({
      providerId: "openrouter:edge",
      modelId: "anthropic/claude:latest",
    });
  });

  test("rejects malformed compound keys", () => {
    expect(decodeAgentModelKey("openrouter/anthropic/claude")).toBeNull();
    expect(decodeAgentModelKey(JSON.stringify(["openrouter"]))).toBeNull();
  });
});
