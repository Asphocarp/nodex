import { describe, expect, test } from "vitest";
import {
  CODEX_DEFAULT_FEATURE_OVERRIDES,
  buildCodexThreadConfigOverrides,
} from "./codex-thread-capabilities";

describe("Codex thread capabilities", () => {
  test("defines one shared capability set for bare and protocol config keys", () => {
    expect(CODEX_DEFAULT_FEATURE_OVERRIDES).toEqual({
      apply_patch_streaming_events: true,
      thread_tools: true,
    });
    expect(buildCodexThreadConfigOverrides()).toEqual({
      "features.apply_patch_streaming_events": true,
      "features.thread_tools": true,
    });
  });
});
