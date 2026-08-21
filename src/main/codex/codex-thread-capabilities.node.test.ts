import { describe, expect, test } from "vite-plus/test";
import {
  CODEX_DEFAULT_FEATURE_OVERRIDES,
  buildCodexThreadConfigOverrides,
} from "./codex-thread-capabilities";

describe("Codex thread capabilities", () => {
  test("defines one shared capability set for bare and protocol config keys", () => {
    expect(CODEX_DEFAULT_FEATURE_OVERRIDES).toEqual({
      apply_patch_streaming_events: true,
      concurrent_reasoning_summaries: true,
      thread_tools: true,
    });
    expect(buildCodexThreadConfigOverrides()).toEqual({
      "features.apply_patch_streaming_events": true,
      "features.concurrent_reasoning_summaries": true,
      "features.thread_tools": true,
    });
  });
});
