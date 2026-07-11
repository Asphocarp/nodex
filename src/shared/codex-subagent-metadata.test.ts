import { describe, expect, test } from "vitest";
import {
  extractCodexThreadSpawnMetadata,
  extractCodexThreadSubagentMetadata,
  getCodexSubagentOtherSource,
  hasCodexSubagentSource,
} from "./codex-subagent-metadata";

describe("codex-subagent-metadata", () => {
  test("extracts source thread_spawn metadata from both supported subagent source casings", () => {
    const camelCaseSource = extractCodexThreadSubagentMetadata({
      source: {
        subAgent: {
          thread_spawn: {
            parent_thread_id: "parent-1",
            depth: 1,
            agent_path: "agents/@Scout",
            agent_nickname: "@Euclid",
            agent_role: "explorer",
          },
        },
      },
    });
    const protocolStyle = extractCodexThreadSubagentMetadata({
      source: {
        subagent: {
          thread_spawn: {
            parent_thread_id: "parent-2",
            depth: 2,
            agent_path: null,
            agent_nickname: "Nash",
            agent_role: "worker",
          },
        },
      },
    });

    expect(JSON.stringify(camelCaseSource)).toBe(JSON.stringify({
      parentThreadId: "parent-1",
      depth: 1,
      agentPath: "agents/@Scout",
      agentNickname: "@Euclid",
      agentRole: "explorer",
      hasParentThreadId: true,
      hasAgentNickname: true,
      hasAgentRole: true,
      hasAnySubagentSource: true,
    }));
    expect(protocolStyle.parentThreadId).toBe("parent-2");
    expect(protocolStyle.agentNickname).toBe("Nash");
    expect(protocolStyle.agentRole).toBe("worker");
  });

  test("prefers top-level thread metadata while preserving source fallback presence", () => {
    const metadata = extractCodexThreadSubagentMetadata({
      parent_thread_id: "parent-top",
      agent_nickname: "Top",
      agent_role: "lead",
      source: {
        subagent: {
          thread_spawn: {
            parent_thread_id: "parent-source",
            agent_nickname: "Source",
            agent_role: "worker",
          },
        },
      },
    });

    expect(metadata.parentThreadId).toBe("parent-top");
    expect(metadata.agentNickname).toBe("Top");
    expect(metadata.agentRole).toBe("lead");
    expect(metadata.hasAgentNickname).toBe(true);
    expect(metadata.hasAgentRole).toBe(true);
  });

  test("distinguishes missing metadata fields from explicit null source fields", () => {
    const missing = extractCodexThreadSubagentMetadata({
      id: "thread-1",
      source: "cli",
    });
    const explicitNulls = extractCodexThreadSubagentMetadata({
      source: {
        subagent: {
          thread_spawn: {
            parent_thread_id: "parent-1",
            agent_nickname: null,
            agent_role: null,
          },
        },
      },
    });
    const directSpawn = extractCodexThreadSpawnMetadata({
      thread_spawn: {
        parent_thread_id: "parent-direct",
        agent_nickname: "@Direct",
      },
    });

    expect(missing.hasAgentNickname).toBe(false);
    expect(missing.agentNickname).toBe(null);
    expect(explicitNulls.hasAgentNickname).toBe(true);
    expect(explicitNulls.agentNickname).toBe(null);
    expect(explicitNulls.hasAgentRole).toBe(true);
    expect(directSpawn.parentThreadId).toBe("parent-direct");
    expect(directSpawn.agentNickname).toBe("@Direct");
  });

  test("recognizes subagent source families that are not thread spawns", () => {
    const guardianSource = {
      subagent: {
        other: "guardian",
      },
    };
    const reviewSource = {
      subAgent: "review",
    };
    const cliSource = "cli";

    expect(hasCodexSubagentSource(guardianSource)).toBe(true);
    expect(getCodexSubagentOtherSource(guardianSource)).toBe("guardian");
    expect(hasCodexSubagentSource(reviewSource)).toBe(true);
    expect(getCodexSubagentOtherSource(reviewSource)).toBe(null);
    expect(hasCodexSubagentSource(cliSource)).toBe(false);
  });
});
