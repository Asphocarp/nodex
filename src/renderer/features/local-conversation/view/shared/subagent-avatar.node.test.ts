import { describe, expect, test } from "vite-plus/test";
import { resolveSubagentAvatarIndex, SUBAGENT_AVATAR_ASSETS } from "./subagent-avatar";

describe("subagent avatar mapping", () => {
  test("matches the frozen zero-based 31 hash for all ten asset indices", () => {
    const seedsByIndex = Array.from({ length: 10 }, () => "");

    for (let candidate = 0; candidate < 10_000; candidate += 1) {
      const seed = `agent-${candidate}`;
      const index = resolveSubagentAvatarIndex(seed);
      if (seedsByIndex[index] === "") seedsByIndex[index] = seed;
      if (seedsByIndex.every(Boolean)) break;
    }

    expect(seedsByIndex.every(Boolean)).toBe(true);
    expect(seedsByIndex.map(resolveSubagentAvatarIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(SUBAGENT_AVATAR_ASSETS).toHaveLength(10);
    expect(SUBAGENT_AVATAR_ASSETS.every(({ dark, light }) => dark !== light)).toBe(true);
  });

  test("is deterministic for empty, Unicode, and surrogate-pair seeds", () => {
    const seeds = ["", "019f3c6a-2ebc-7b82-ab83-cb7edb449ada", "代理", "agent-🤖"];

    expect(seeds.map(resolveSubagentAvatarIndex)).toEqual(seeds.map(resolveSubagentAvatarIndex));
    expect(resolveSubagentAvatarIndex("")).toBe(0);
    expect(resolveSubagentAvatarIndex("agent-🤖")).toBe(6);
  });
});
