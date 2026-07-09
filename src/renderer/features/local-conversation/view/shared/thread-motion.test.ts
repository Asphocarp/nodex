import { describe, expect, test } from "vitest";
import {
  CODEX_THREAD_ACCORDION_TRANSITION,
  CODEX_THREAD_DIVIDER_ENTER_ANIMATE,
  CODEX_THREAD_DIVIDER_ENTER_INITIAL,
  CODEX_THREAD_DIVIDER_EXIT,
} from "./thread-motion";

describe("thread motion contract", () => {
  test("matches Codex Electron accordion timing", () => {
    expect(CODEX_THREAD_ACCORDION_TRANSITION.duration).toBe(0.3);
    expect(Array.isArray(CODEX_THREAD_ACCORDION_TRANSITION.ease) ? CODEX_THREAD_ACCORDION_TRANSITION.ease.join(",") : "").toBe("0.19,1,0.22,1");
  });

  test("uses the Codex Electron divider reveal shape", () => {
    expect(CODEX_THREAD_DIVIDER_ENTER_INITIAL.opacity).toBe(0);
    expect(CODEX_THREAD_DIVIDER_ENTER_INITIAL.height).toBe(0);
    expect(CODEX_THREAD_DIVIDER_ENTER_ANIMATE.opacity).toBe(1);
    expect(CODEX_THREAD_DIVIDER_ENTER_ANIMATE.height).toBe("auto");
    expect(CODEX_THREAD_DIVIDER_EXIT.opacity).toBe(0);
    expect(CODEX_THREAD_DIVIDER_EXIT.height).toBe(0);
  });
});
