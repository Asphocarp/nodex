import type { AgentActivityV2ProjectionFixture } from "./agent-activity-v2-fixture-schema";
import {
  AGENT_ACTIVITY_V2_CORPUS_SANITIZATION,
  AGENT_ACTIVITY_V2_CORPUS_THREAD_ID,
  AGENT_ACTIVITY_V2_CORPUS_TURN_ID,
  buildAgentActivityV2BundleProvenance,
  buildAgentActivityV2CorpusThread,
} from "./agent-activity-v2-corpus-provenance";
import {
  agentActivityV2DynamicCreateThreadItem,
  agentActivityV2DynamicHandoffItem,
  agentActivityV2DynamicLoadWorkspaceIgnoredItem,
  agentActivityV2McpBrowserSourceItem,
  agentActivityV2MixedPatchItem,
  agentActivityV2MultiActionCommandItem,
  agentActivityV2WebSearchItem,
} from "./agent-activity-v2-item-family-corpus";
import {
  agentActivityV2CommandApprovalRequest,
  agentActivityV2DynamicToolRequest,
} from "./agent-activity-v2-request-family-corpus";

const REASONING_ITEM_ID = "reasoning-hidden";

export const agentActivityV2MixedFamilyFixture = {
  schemaVersion: 1,
  replay: {
    id: "codex-electron-26.707.30751-agent-activity-v2-representative-corpus",
    threadId: AGENT_ACTIVITY_V2_CORPUS_THREAD_ID,
    targetState: "mixed command, patch, web, MCP, and dynamic run with pending command approval",
    provenance: buildAgentActivityV2BundleProvenance([
      "h59fr3q5.pretty.js:95412-96139 (complete raw item/request projection)",
      "h59fr3q5.pretty.js:66292-66649 (command, patch, MCP result helpers)",
      "g4rafana.pretty.js:4528-4552,5393-5524 (MCP resolution and classification)",
      "g4rafana.pretty.js:6186-6232,6317-6328 (indexed grouping and identity)",
      "g4rafana.pretty.js:30844-30855 (activity-source array call site)",
      "k0ede4gb.pretty.js:254721-254750,254905-254924 (dynamic registry policy)",
    ]),
    sanitization: AGENT_ACTIVITY_V2_CORPUS_SANITIZATION,
    initialThread: buildAgentActivityV2CorpusThread([
      agentActivityV2MultiActionCommandItem,
      {
        type: "reasoning",
        id: REASONING_ITEM_ID,
        summary: ["Checking representative payloads"],
        content: [],
      },
      agentActivityV2MixedPatchItem,
      agentActivityV2WebSearchItem,
      agentActivityV2McpBrowserSourceItem,
      agentActivityV2DynamicCreateThreadItem,
      agentActivityV2DynamicHandoffItem,
      agentActivityV2DynamicLoadWorkspaceIgnoredItem,
    ]),
    events: [
      {
        type: "request",
        request: agentActivityV2CommandApprovalRequest,
      },
      {
        type: "request",
        request: agentActivityV2DynamicToolRequest,
      },
    ],
  },
  projectionContext: {
    turnId: AGENT_ACTIVITY_V2_CORPUS_TURN_ID,
    isBackgroundSubagentsEnabled: true,
    preserveServerUserMessages: false,
    mcpServerStatuses: {
      data: [],
      nextCursor: null,
    },
  },
  expected: {
    projectedItems: [
      {
        projectedItemIndex: 0,
        itemType: "exec",
        sourceReferences: [{
          kind: "thread-item",
          id: agentActivityV2MultiActionCommandItem.id,
        }],
      },
      {
        projectedItemIndex: 1,
        itemType: "exec",
        sourceReferences: [{
          kind: "thread-item",
          id: agentActivityV2MultiActionCommandItem.id,
        }],
      },
      {
        projectedItemIndex: 2,
        itemType: "exec",
        sourceReferences: [{
          kind: "thread-item",
          id: agentActivityV2MultiActionCommandItem.id,
        }],
      },
      {
        projectedItemIndex: 3,
        itemType: "exec",
        sourceReferences: [{
          kind: "thread-item",
          id: agentActivityV2MultiActionCommandItem.id,
        }],
      },
      {
        projectedItemIndex: 4,
        itemType: "reasoning",
        sourceReferences: [{ kind: "thread-item", id: REASONING_ITEM_ID }],
      },
      {
        projectedItemIndex: 5,
        itemType: "patch",
        sourceReferences: [{ kind: "thread-item", id: agentActivityV2MixedPatchItem.id }],
      },
      {
        projectedItemIndex: 6,
        itemType: "web-search",
        sourceReferences: [{
          kind: "thread-item",
          id: agentActivityV2WebSearchItem.id,
        }],
      },
      {
        projectedItemIndex: 7,
        itemType: "mcp-tool-call",
        sourceReferences: [{
          kind: "thread-item",
          id: agentActivityV2McpBrowserSourceItem.id,
        }],
      },
      {
        projectedItemIndex: 8,
        itemType: "dynamic-tool-call",
        sourceReferences: [{
          kind: "thread-item",
          id: agentActivityV2DynamicCreateThreadItem.id,
        }],
      },
      {
        projectedItemIndex: 9,
        itemType: "dynamic-tool-call",
        sourceReferences: [{
          kind: "thread-item",
          id: agentActivityV2DynamicHandoffItem.id,
        }],
      },
      {
        projectedItemIndex: 10,
        itemType: "turn-diff",
        sourceReferences: [{
          kind: "thread-item",
          id: agentActivityV2MixedPatchItem.id,
        }],
      },
      {
        projectedItemIndex: 11,
        itemType: "exec",
        sourceReferences: [{
          kind: "server-request",
          id: agentActivityV2CommandApprovalRequest.id,
          usage: "pending-request-projection",
        }],
      },
    ],
    activitySourceItems: [
      {
        activitySourceIndex: 0,
        origin: { kind: "projected", projectedItemIndexes: [0] },
        itemType: "exec",
        classification: "groupable",
        identityCandidates: { callId: "command-multi:0" },
        identity: { field: "callId", value: "command-multi:0" },
      },
      {
        activitySourceIndex: 1,
        origin: { kind: "projected", projectedItemIndexes: [1] },
        itemType: "exec",
        classification: "groupable",
        identityCandidates: { callId: "command-multi:1" },
        identity: { field: "callId", value: "command-multi:1" },
      },
      {
        activitySourceIndex: 2,
        origin: { kind: "projected", projectedItemIndexes: [2] },
        itemType: "exec",
        classification: "groupable",
        identityCandidates: { callId: "command-multi:2" },
        identity: { field: "callId", value: "command-multi:2" },
      },
      {
        activitySourceIndex: 3,
        origin: { kind: "projected", projectedItemIndexes: [3] },
        itemType: "exec",
        classification: "groupable",
        identityCandidates: { callId: "command-multi:3" },
        identity: { field: "callId", value: "command-multi:3" },
      },
      {
        activitySourceIndex: 4,
        origin: { kind: "projected", projectedItemIndexes: [4] },
        itemType: "reasoning",
        classification: "hidden",
        identityCandidates: {},
        identity: null,
      },
      {
        activitySourceIndex: 5,
        origin: { kind: "projected", projectedItemIndexes: [5] },
        itemType: "patch",
        classification: "groupable",
        identityCandidates: { callId: agentActivityV2MixedPatchItem.id },
        identity: { field: "callId", value: agentActivityV2MixedPatchItem.id },
      },
      {
        activitySourceIndex: 6,
        origin: { kind: "projected", projectedItemIndexes: [6] },
        itemType: "web-search",
        classification: "groupable",
        identityCandidates: {},
        identity: { field: "fallback", value: "web-search:6" },
      },
      {
        activitySourceIndex: 7,
        origin: { kind: "projected", projectedItemIndexes: [7] },
        itemType: "mcp-tool-call",
        classification: "groupable",
        identityCandidates: { callId: agentActivityV2McpBrowserSourceItem.id },
        identity: { field: "callId", value: agentActivityV2McpBrowserSourceItem.id },
      },
      {
        activitySourceIndex: 8,
        origin: { kind: "projected", projectedItemIndexes: [8] },
        itemType: "dynamic-tool-call",
        classification: "groupable",
        identityCandidates: { callId: agentActivityV2DynamicCreateThreadItem.id },
        identity: { field: "callId", value: agentActivityV2DynamicCreateThreadItem.id },
      },
      {
        activitySourceIndex: 9,
        origin: { kind: "projected", projectedItemIndexes: [9] },
        itemType: "dynamic-tool-call",
        classification: "standalone",
        identityCandidates: { callId: agentActivityV2DynamicHandoffItem.id },
        identity: { field: "callId", value: agentActivityV2DynamicHandoffItem.id },
      },
    ],
    units: [
      {
        kind: "group",
        key: "agent-activity-group:command-multi:0",
        activitySourceIndexes: [0, 1, 2, 3, 5, 6, 7, 8],
      },
      {
        kind: "standalone",
        key: "agent-activity-standalone:dynamic-handoff-thread",
        activitySourceIndex: 9,
      },
    ],
  },
} satisfies AgentActivityV2ProjectionFixture;
