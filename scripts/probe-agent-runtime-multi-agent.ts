import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type { ServerNotification } from "@nodex/codex-app-server-protocol";
import { ScopedCallbackRuntime } from "../src/main/app/ScopedCallbackRuntime";
import { resolveCodexRuntime } from "../src/main/codex/codex-runtime";
import {
  type CodexProbeClient,
  openCodexProbeSession,
  runCodexProbeMain,
  withCodexProbeSession,
} from "./codex-probe-session";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const requestTimeoutMs = 60_000;
const namespace = "collaboration";
const rootRollbackMarker = "NODEX_SEMANTIC_ROLLBACK_ROOT";
const rootCountMarker = "NODEX_SEMANTIC_COUNT_ROOT";
const countChildMarker = "NODEX_SEMANTIC_COUNT_CHILD";
const overflowChildMarker = "NODEX_SEMANTIC_OVERFLOW_CHILD";
const retryChildMarker = "NODEX_SEMANTIC_RETRY_CHILD";
const rootFlowMarker = "NODEX_SEMANTIC_FLOW_ROOT";
const alphaInitialMarker = "NODEX_SEMANTIC_ALPHA_INITIAL";
const alphaPingMarker = "NODEX_SEMANTIC_ALPHA_PING";
const alphaReloadMarker = "NODEX_SEMANTIC_ALPHA_RELOAD";
const alphaInterruptMarker = "NODEX_SEMANTIC_ALPHA_INTERRUPT";
const alphaReuseMarker = "NODEX_SEMANTIC_ALPHA_REUSE";
const betaInitialMarker = "NODEX_SEMANTIC_BETA_INITIAL";
const betaReloadMarker = "NODEX_SEMANTIC_BETA_RELOAD";
const gammaInitialMarker = "NODEX_SEMANTIC_GAMMA_INITIAL";
const durableRootPrepareMarker = "NODEX_DURABLE_COMPLETION_PREPARE_ROOT";
const durableRootRecoverMarker = "NODEX_DURABLE_COMPLETION_RECOVER_ROOT";
const durableRootVerifyMarker = "NODEX_DURABLE_COMPLETION_VERIFY_ROOT";
const durableParentInitialMarker = "NODEX_DURABLE_COMPLETION_PARENT_INITIAL";
const durableParentRecoverMarker = "NODEX_DURABLE_COMPLETION_PARENT_RECOVER";
const durableParentVerifyMarker = "NODEX_DURABLE_COMPLETION_PARENT_VERIFY";
const durableChildInitialMarker = "NODEX_DURABLE_COMPLETION_CHILD_INITIAL";
const durableChildResultMarker = "NODEX_DURABLE_COMPLETION_CHILD_RESULT";
const durablePressureMarker = "NODEX_DURABLE_COMPLETION_PRESSURE";

type JsonRecord = Record<string, unknown>;

type SemanticState = {
  alphaCompleted: boolean;
  alphaInterruptRequestAborted: boolean;
  alphaInterruptRequestStarted: boolean;
  alphaPingObserved: boolean;
  betaCompleted: boolean;
  betaEvictedObserved: boolean;
  betaReloadObserved: boolean;
  countChildRequestAborted: boolean;
  countChildRequestStarted: boolean;
  countMailboxAccepted: number;
  countPhase: number;
  countTypedOverflowObserved: boolean;
  durableChildCompleted: boolean;
  durableParentEnvelopeObserved: boolean;
  durableParentRecoveredMarkerCount: number;
  durableParentPhase: number;
  durableParentVerifiedAfterRestart: boolean;
  durableParentVerifiedMarkerCount: number;
  durableRootPreparePhase: number;
  durableRootRecoverPhase: number;
  durableRootVerifyPhase: number;
  flowPhase: number;
  gammaCompleted: boolean;
  nestedDirectParentEnvelopeObserved: boolean;
  rollbackPhase: number;
  rollbackTypedOverflowObserved: boolean;
};

export type AgentRuntimeMultiAgentConformanceReport = {
  readonly binaryPath: string;
  readonly capabilities: {
    readonly cleanup: "pass";
    readonly completionDeliveryAndNestedDirectParent: "pass";
    readonly durableCompletionReplayAfterRestart: "pass";
    readonly followupAfterInterruptReuse: "pass";
    readonly interruptListAndWait: "pass";
    readonly mailboxCountAndByteCapacity: "pass";
    readonly residencyEvictionAndReload: "pass";
    readonly sendMessage: "pass";
    readonly spawnRollback: "pass";
    readonly spawnSuccess: "pass";
  };
  readonly durableCompletionEvidence: {
    readonly firstRecoveryOccurrences: number;
    readonly secondRestartOccurrences: number;
  };
  readonly generatedAt: string;
  readonly observedSubagentActivityEvents: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error("Semantic probe received a non-object request body");
  return parsed;
}

function inputItems(body: JsonRecord): readonly unknown[] {
  return Array.isArray(body.input) ? body.input : [];
}

function inputContains(body: JsonRecord, marker: string): boolean {
  return JSON.stringify(inputItems(body)).includes(marker);
}

function hasAgentMessage(body: JsonRecord, marker: string): boolean {
  return inputItems(body).some(
    (item) =>
      isRecord(item) && item.type === "agent_message" && JSON.stringify(item).includes(marker),
  );
}

function agentMessageMarkerCount(body: JsonRecord, marker: string): number {
  return inputItems(body).reduce<number>((count, item) => {
    if (!isRecord(item) || item.type !== "agent_message") return count;
    return count + JSON.stringify(item).split(marker).length - 1;
  }, 0);
}

function functionOutput(body: JsonRecord, callId: string): string | null {
  const item = inputItems(body).find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.type === "function_call_output" &&
      candidate.call_id === callId,
  );
  return item ? JSON.stringify(item) : null;
}

function requireFunctionOutput(body: JsonRecord, callId: string): string {
  const output = functionOutput(body, callId);
  if (output) return output;
  throw new Error(`Semantic probe did not receive function output for ${callId}`);
}

function sendResponsesEvents(response: ServerResponse, events: readonly JsonRecord[]): void {
  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
  });
  response.end(
    events
      .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
      .join(""),
  );
}

function created(responseId: string): JsonRecord {
  return { type: "response.created", response: { id: responseId } };
}

function completed(responseId: string): JsonRecord {
  return {
    type: "response.completed",
    response: {
      id: responseId,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  };
}

function toolCall(callId: string, name: string, arguments_: JsonRecord): JsonRecord {
  return {
    type: "response.output_item.done",
    item: {
      type: "function_call",
      call_id: callId,
      namespace,
      name,
      arguments: JSON.stringify(arguments_),
    },
  };
}

function assistantMessage(text: string): JsonRecord {
  return {
    type: "response.output_item.done",
    item: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  };
}

function respondWithTool(
  response: ServerResponse,
  responseId: string,
  callId: string,
  name: string,
  arguments_: JsonRecord,
): void {
  sendResponsesEvents(response, [
    created(responseId),
    toolCall(callId, name, arguments_),
    completed(responseId),
  ]);
}

function respondWithTools(
  response: ServerResponse,
  responseId: string,
  calls: ReadonlyArray<{
    readonly arguments: JsonRecord;
    readonly callId: string;
    readonly name: string;
  }>,
): void {
  sendResponsesEvents(response, [
    created(responseId),
    ...calls.map((call) => toolCall(call.callId, call.name, call.arguments)),
    completed(responseId),
  ]);
}

function respondWithText(response: ServerResponse, responseId: string, text: string): void {
  sendResponsesEvents(response, [
    created(responseId),
    assistantMessage(text),
    completed(responseId),
  ]);
}

function statusFromListOutput(output: string, taskPath: string): string | null {
  const item = JSON.parse(output) as unknown;
  if (!isRecord(item) || typeof item.output !== "string") return null;
  const payload = JSON.parse(item.output) as unknown;
  if (!isRecord(payload) || !Array.isArray(payload.agents)) return null;
  const agent = payload.agents.find(
    (candidate) => isRecord(candidate) && candidate.agent_name === taskPath,
  );
  if (!isRecord(agent)) return null;
  if (typeof agent.agent_status === "string") return agent.agent_status;
  if (!isRecord(agent.agent_status)) return null;
  if (typeof agent.agent_status.completed === "string") return "completed";
  return null;
}

function handleRollbackRoot(
  body: JsonRecord,
  response: ServerResponse,
  state: SemanticState,
): void {
  if (state.rollbackPhase === 0) {
    state.rollbackPhase = 1;
    respondWithTool(response, "rollback-spawn", "rollback_spawn", "spawn_agent", {
      task_name: "overflow",
      fork_turns: "none",
      message: `${overflowChildMarker}:${"x".repeat(2 * 1024 * 1024)}`,
    });
    return;
  }
  if (state.rollbackPhase === 1) {
    const output = requireFunctionOutput(body, "rollback_spawn");
    if (!/mailbox|capacity|max_bytes/iu.test(output)) {
      throw new Error(`Oversized spawn did not return typed mailbox capacity output: ${output}`);
    }
    state.rollbackTypedOverflowObserved = true;
    state.rollbackPhase = 2;
    respondWithTool(response, "rollback-list", "rollback_list", "list_agents", {});
    return;
  }
  if (state.rollbackPhase === 2) {
    const output = requireFunctionOutput(body, "rollback_list");
    if (output.includes("/root/overflow")) {
      throw new Error(`Failed spawn left a phantom registry or residency entry: ${output}`);
    }
    state.rollbackPhase = 3;
    respondWithTool(response, "rollback-retry", "rollback_retry", "spawn_agent", {
      task_name: "overflow",
      fork_turns: "none",
      message: retryChildMarker,
    });
    return;
  }
  const output = requireFunctionOutput(body, "rollback_retry");
  if (!output.includes("/root/overflow")) {
    throw new Error(`Rolled-back nickname was not reusable: ${output}`);
  }
  state.rollbackPhase = 4;
  respondWithText(response, "rollback-finished", "rollback conformance complete");
}

async function handleCountRoot(
  body: JsonRecord,
  response: ServerResponse,
  state: SemanticState,
): Promise<void> {
  if (state.countPhase === 0) {
    state.countPhase = 1;
    respondWithTool(response, "count-spawn", "count_spawn", "spawn_agent", {
      task_name: "count_saturation",
      fork_turns: "none",
      message: countChildMarker,
    });
    return;
  }
  if (state.countPhase === 1) {
    const output = requireFunctionOutput(body, "count_spawn");
    if (!output.includes("/root/count_saturation")) {
      throw new Error(`Count-capacity child spawn failed: ${output}`);
    }
    for (let attempt = 0; attempt < 200 && !state.countChildRequestStarted; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!state.countChildRequestStarted) {
      throw new Error("Count-capacity child did not enter its blocking provider request");
    }
    state.countPhase = 2;
    respondWithTools(
      response,
      "count-fill",
      Array.from({ length: 257 }, (_, index) => ({
        arguments: {
          target: "/root/count_saturation",
          message: `count-message-${String(index).padStart(3, "0")}`,
        },
        callId: `count_send_${index}`,
        name: "send_message",
      })),
    );
    return;
  }
  if (state.countPhase === 2) {
    const outputs = Array.from({ length: 257 }, (_, index) =>
      requireFunctionOutput(body, `count_send_${index}`),
    );
    const rejected = outputs.filter((output) => /mailbox|capacity|max_messages/iu.test(output));
    state.countMailboxAccepted = outputs.length - rejected.length;
    if (state.countMailboxAccepted !== 256 || rejected.length !== 1) {
      throw new Error(
        `Mailbox count admission was not exactly 256 accepted / 1 rejected: ` +
          `${state.countMailboxAccepted}/${rejected.length}`,
      );
    }
    state.countTypedOverflowObserved = true;
    state.countPhase = 3;
    respondWithTool(response, "count-interrupt", "count_interrupt", "interrupt_agent", {
      target: "/root/count_saturation",
    });
    return;
  }
  requireFunctionOutput(body, "count_interrupt");
  state.countPhase = 4;
  respondWithText(response, "count-finished", "count capacity conformance complete");
}

function listOrWaitForStatus(input: {
  body: JsonRecord;
  expectedStatus: string;
  listCallId: string;
  response: ServerResponse;
  responseId: string;
  state: SemanticState;
  taskPath: string;
  waitCallId: string;
}): boolean {
  const output = requireFunctionOutput(input.body, input.listCallId);
  const status = statusFromListOutput(output, input.taskPath);
  if (status === input.expectedStatus) return true;
  if (!status) throw new Error(`list_agents omitted ${input.taskPath}: ${output}`);
  respondWithTool(input.response, input.responseId, input.waitCallId, "wait_agent", {
    timeout_ms: 5_000,
  });
  input.state.flowPhase -= 1;
  return false;
}

function handleFlowRoot(body: JsonRecord, response: ServerResponse, state: SemanticState): void {
  switch (state.flowPhase) {
    case 0:
      state.flowPhase = 1;
      respondWithTool(response, "flow-spawn-alpha", "flow_spawn_alpha", "spawn_agent", {
        task_name: "alpha",
        fork_turns: "none",
        message: alphaInitialMarker,
      });
      return;
    case 1: {
      const output = requireFunctionOutput(body, "flow_spawn_alpha");
      if (!output.includes("/root/alpha")) throw new Error(`Alpha spawn failed: ${output}`);
      state.flowPhase = 2;
      respondWithTool(response, "flow-send", "flow_send", "send_message", {
        target: "/root/alpha",
        message: alphaPingMarker,
      });
      return;
    }
    case 2:
      requireFunctionOutput(body, "flow_send");
      state.flowPhase = 3;
      respondWithTool(response, "flow-wait-alpha", "flow_wait_alpha", "wait_agent", {
        timeout_ms: 5_000,
      });
      return;
    case 3:
      requireFunctionOutput(body, "flow_wait_alpha");
      state.flowPhase = 4;
      respondWithTool(response, "flow-list-alpha", "flow_list_alpha", "list_agents", {});
      return;
    case 4:
      if (
        !listOrWaitForStatus({
          body,
          expectedStatus: "completed",
          listCallId: "flow_list_alpha",
          response,
          responseId: "flow-rewait-alpha",
          state,
          taskPath: "/root/alpha",
          waitCallId: "flow_wait_alpha",
        })
      ) {
        return;
      }
      state.alphaCompleted = true;
      state.flowPhase = 5;
      respondWithTool(response, "flow-touch-alpha", "flow_touch_alpha", "send_message", {
        target: "/root/alpha",
        message: "NODEX_SEMANTIC_ALPHA_RESIDENCY_TOUCH",
      });
      return;
    case 5:
      requireFunctionOutput(body, "flow_touch_alpha");
      state.flowPhase = 6;
      respondWithTool(response, "flow-spawn-gamma", "flow_spawn_gamma", "spawn_agent", {
        task_name: "gamma",
        fork_turns: "none",
        message: gammaInitialMarker,
      });
      return;
    case 6:
      requireFunctionOutput(body, "flow_spawn_gamma");
      state.flowPhase = 7;
      respondWithTool(response, "flow-wait-gamma", "flow_wait_gamma", "wait_agent", {
        timeout_ms: 5_000,
      });
      return;
    case 7:
      requireFunctionOutput(body, "flow_wait_gamma");
      state.flowPhase = 8;
      respondWithTool(response, "flow-list-gamma", "flow_list_gamma", "list_agents", {});
      return;
    case 8:
      if (
        !listOrWaitForStatus({
          body,
          expectedStatus: "completed",
          listCallId: "flow_list_gamma",
          response,
          responseId: "flow-rewait-gamma",
          state,
          taskPath: "/root/gamma",
          waitCallId: "flow_wait_gamma",
        })
      ) {
        return;
      }
      state.gammaCompleted = true;
      if (
        statusFromListOutput(requireFunctionOutput(body, "flow_list_gamma"), "/root/alpha/beta")
      ) {
        throw new Error("Residency pressure did not evict the oldest completed nested agent");
      }
      state.betaEvictedObserved = true;
      state.flowPhase = 9;
      respondWithTool(response, "flow-followup-reload", "flow_followup_reload", "followup_task", {
        target: "/root/alpha",
        message: alphaReloadMarker,
      });
      return;
    case 9:
      requireFunctionOutput(body, "flow_followup_reload");
      state.flowPhase = 10;
      respondWithTool(response, "flow-wait-reload", "flow_wait_reload", "wait_agent", {
        timeout_ms: 5_000,
      });
      return;
    case 10:
      requireFunctionOutput(body, "flow_wait_reload");
      state.flowPhase = 11;
      respondWithTool(response, "flow-list-reload", "flow_list_reload", "list_agents", {});
      return;
    case 11:
      if (
        !listOrWaitForStatus({
          body,
          expectedStatus: "completed",
          listCallId: "flow_list_reload",
          response,
          responseId: "flow-rewait-reload",
          state,
          taskPath: "/root/alpha",
          waitCallId: "flow_wait_reload",
        })
      ) {
        return;
      }
      state.flowPhase = 12;
      respondWithTool(
        response,
        "flow-followup-interrupt",
        "flow_followup_interrupt",
        "followup_task",
        {
          target: "/root/alpha",
          message: alphaInterruptMarker,
        },
      );
      return;
    case 12:
      requireFunctionOutput(body, "flow_followup_interrupt");
      state.flowPhase = 13;
      respondWithTool(response, "flow-interrupt", "flow_interrupt", "interrupt_agent", {
        target: "/root/alpha",
      });
      return;
    case 13:
      requireFunctionOutput(body, "flow_interrupt");
      state.flowPhase = 14;
      respondWithTool(
        response,
        "flow-list-interrupted",
        "flow_list_interrupted",
        "list_agents",
        {},
      );
      return;
    case 14: {
      const output = requireFunctionOutput(body, "flow_list_interrupted");
      const status = statusFromListOutput(output, "/root/alpha");
      if (status !== "interrupted") {
        throw new Error(`Interrupted alpha was not resident and listed as interrupted: ${output}`);
      }
      state.flowPhase = 15;
      respondWithTool(response, "flow-followup-reuse", "flow_followup_reuse", "followup_task", {
        target: "/root/alpha",
        message: alphaReuseMarker,
      });
      return;
    }
    case 15:
      requireFunctionOutput(body, "flow_followup_reuse");
      state.flowPhase = 16;
      respondWithTool(response, "flow-wait-reuse", "flow_wait_reuse", "wait_agent", {
        timeout_ms: 5_000,
      });
      return;
    case 16:
      requireFunctionOutput(body, "flow_wait_reuse");
      state.flowPhase = 17;
      respondWithTool(response, "flow-list-final", "flow_list_final", "list_agents", {});
      return;
    default: {
      if (
        !listOrWaitForStatus({
          body,
          expectedStatus: "completed",
          listCallId: "flow_list_final",
          response,
          responseId: "flow-rewait-reuse",
          state,
          taskPath: "/root/alpha",
          waitCallId: "flow_wait_reuse",
        })
      ) {
        return;
      }
      state.flowPhase = 18;
      respondWithText(response, "flow-finished", "multi-agent semantic conformance complete");
    }
  }
}

function handleDurableRootPrepare(
  body: JsonRecord,
  response: ServerResponse,
  state: SemanticState,
): void {
  switch (state.durableRootPreparePhase) {
    case 0:
      state.durableRootPreparePhase = 1;
      respondWithTool(response, "durable-spawn-parent", "durable_spawn_parent", "spawn_agent", {
        task_name: "durable_parent",
        fork_turns: "none",
        message: durableParentInitialMarker,
      });
      return;
    case 1:
      requireFunctionOutput(body, "durable_spawn_parent");
      state.durableRootPreparePhase = 2;
      respondWithTool(response, "durable-wait-parent", "durable_wait_parent", "wait_agent", {
        timeout_ms: 5_000,
      });
      return;
    case 2:
      requireFunctionOutput(body, "durable_wait_parent");
      state.durableRootPreparePhase = 3;
      respondWithTool(response, "durable-spawn-pressure", "durable_spawn_pressure", "spawn_agent", {
        task_name: "durable_pressure",
        fork_turns: "none",
        message: durablePressureMarker,
      });
      return;
    case 3:
      requireFunctionOutput(body, "durable_spawn_pressure");
      state.durableRootPreparePhase = 4;
      respondWithTool(response, "durable-wait-pressure", "durable_wait_pressure", "wait_agent", {
        timeout_ms: 5_000,
      });
      return;
    case 4:
      requireFunctionOutput(body, "durable_wait_pressure");
      state.durableRootPreparePhase = 5;
      respondWithTool(response, "durable-wait-child", "durable_wait_child", "wait_agent", {
        timeout_ms: 5_000,
      });
      return;
    default:
      requireFunctionOutput(body, "durable_wait_child");
      state.durableRootPreparePhase = 6;
      respondWithText(response, "durable-prepared", "durable completion restart prepared");
  }
}

function handleDurableRootRecover(
  body: JsonRecord,
  response: ServerResponse,
  state: SemanticState,
): void {
  switch (state.durableRootRecoverPhase) {
    case 0:
      state.durableRootRecoverPhase = 1;
      respondWithTool(
        response,
        "durable-followup-parent",
        "durable_followup_parent",
        "followup_task",
        {
          target: "/root/durable_parent",
          message: durableParentRecoverMarker,
        },
      );
      return;
    case 1:
      requireFunctionOutput(body, "durable_followup_parent");
      state.durableRootRecoverPhase = 2;
      respondWithTool(
        response,
        "durable-wait-recovered-parent",
        "durable_wait_recovered_parent",
        "wait_agent",
        { timeout_ms: 5_000 },
      );
      return;
    default:
      requireFunctionOutput(body, "durable_wait_recovered_parent");
      state.durableRootRecoverPhase = 3;
      respondWithText(response, "durable-recovered", "durable completion restart recovered");
  }
}

function handleDurableRootVerify(
  body: JsonRecord,
  response: ServerResponse,
  state: SemanticState,
): void {
  switch (state.durableRootVerifyPhase) {
    case 0:
      state.durableRootVerifyPhase = 1;
      respondWithTool(
        response,
        "durable-verify-followup-parent",
        "durable_verify_followup_parent",
        "followup_task",
        {
          target: "/root/durable_parent",
          message: durableParentVerifyMarker,
        },
      );
      return;
    case 1:
      requireFunctionOutput(body, "durable_verify_followup_parent");
      state.durableRootVerifyPhase = 2;
      respondWithTool(
        response,
        "durable-verify-wait-parent",
        "durable_verify_wait_parent",
        "wait_agent",
        { timeout_ms: 5_000 },
      );
      return;
    default:
      requireFunctionOutput(body, "durable_verify_wait_parent");
      state.durableRootVerifyPhase = 3;
      respondWithText(
        response,
        "durable-verified",
        "durable completion remained unique after a second restart",
      );
  }
}

async function handleSemanticRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: SemanticState,
): Promise<void> {
  const body = await readJsonBody(request);
  if (hasAgentMessage(body, durableChildInitialMarker)) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    state.durableChildCompleted = true;
    respondWithText(response, "durable-child-result", durableChildResultMarker);
    return;
  }
  if (hasAgentMessage(body, durablePressureMarker)) {
    respondWithText(response, "durable-pressure-result", "durable pressure complete");
    return;
  }
  if (hasAgentMessage(body, durableParentVerifyMarker)) {
    const markerCount = agentMessageMarkerCount(body, durableChildResultMarker);
    state.durableParentVerifiedMarkerCount = markerCount;
    if (markerCount !== 1) {
      throw new Error(
        `Durable child completion appeared ${markerCount} times after a second process restart`,
      );
    }
    state.durableParentVerifiedAfterRestart = true;
    respondWithText(
      response,
      "durable-parent-verified",
      "durable child completion remained unique",
    );
    return;
  }
  if (hasAgentMessage(body, durableParentRecoverMarker)) {
    if (hasAgentMessage(body, durableChildResultMarker)) {
      const markerCount = agentMessageMarkerCount(body, durableChildResultMarker);
      state.durableParentRecoveredMarkerCount = markerCount;
      if (markerCount !== 1) {
        throw new Error(
          `Durable child completion appeared ${markerCount} times in the recovered provider request`,
        );
      }
      state.durableParentEnvelopeObserved = true;
      state.durableParentPhase = 3;
      respondWithText(response, "durable-parent-recovered", "durable parent recovered result");
      return;
    }
    if (state.durableParentPhase >= 2) {
      throw new Error(
        "Recovered parent did not receive durable child completion after replay wait",
      );
    }
    state.durableParentPhase = 2;
    respondWithTool(
      response,
      "durable-parent-replay-wait",
      "durable_parent_replay_wait",
      "wait_agent",
      {
        timeout_ms: 5_000,
      },
    );
    return;
  }
  if (hasAgentMessage(body, durableParentInitialMarker)) {
    if (!functionOutput(body, "durable_parent_spawn_child")) {
      respondWithTool(
        response,
        "durable-parent-spawn-child",
        "durable_parent_spawn_child",
        "spawn_agent",
        {
          task_name: "durable_child",
          fork_turns: "none",
          message: durableChildInitialMarker,
        },
      );
      return;
    }
    state.durableParentPhase = 1;
    respondWithText(response, "durable-parent-initial-complete", "durable parent now idle");
    return;
  }
  if (hasAgentMessage(body, countChildMarker)) {
    state.countChildRequestStarted = true;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 10_000);
      const aborted = (): void => {
        clearTimeout(timeout);
        state.countChildRequestAborted = true;
        resolve();
      };
      request.once("aborted", aborted);
      response.once("close", aborted);
    });
    if (!state.countChildRequestAborted && !response.destroyed) {
      respondWithText(response, "count-child-timeout", "count saturation interrupt did not arrive");
    }
    return;
  }
  if (hasAgentMessage(body, retryChildMarker)) {
    respondWithText(response, "retry-child", "retry child complete");
    return;
  }
  if (hasAgentMessage(body, gammaInitialMarker)) {
    state.gammaCompleted = true;
    respondWithText(response, "gamma-child", "gamma complete");
    return;
  }
  if (hasAgentMessage(body, betaReloadMarker)) {
    state.betaReloadObserved = true;
    respondWithText(response, "beta-reload", "beta reload complete");
    return;
  }
  if (hasAgentMessage(body, betaInitialMarker)) {
    state.betaCompleted = true;
    await new Promise((resolve) => setTimeout(resolve, 250));
    respondWithText(response, "beta-child", "beta initial complete");
    return;
  }
  if (hasAgentMessage(body, alphaReuseMarker)) {
    respondWithText(response, "alpha-reuse", "alpha reuse complete");
    return;
  }
  if (hasAgentMessage(body, alphaInterruptMarker)) {
    state.alphaInterruptRequestStarted = true;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 10_000);
      const aborted = (): void => {
        clearTimeout(timeout);
        state.alphaInterruptRequestAborted = true;
        resolve();
      };
      request.once("aborted", aborted);
      response.once("close", aborted);
    });
    if (!state.alphaInterruptRequestAborted && !response.destroyed) {
      respondWithText(response, "alpha-interrupt-timeout", "interrupt did not arrive");
    }
    return;
  }
  if (hasAgentMessage(body, alphaReloadMarker)) {
    if (!functionOutput(body, "alpha_reload_beta")) {
      respondWithTool(response, "alpha-reload-beta", "alpha_reload_beta", "followup_task", {
        target: "/root/alpha/beta",
        message: betaReloadMarker,
      });
      return;
    }
    requireFunctionOutput(body, "alpha_reload_beta");
    respondWithText(response, "alpha-reload", "alpha reload complete");
    return;
  }
  if (hasAgentMessage(body, alphaInitialMarker)) {
    const spawnOutput = functionOutput(body, "alpha_spawn_beta");
    if (!spawnOutput) {
      // Give app-server time to install its watch for the just-spawned alpha thread before
      // alpha emits nested activity. This mirrors the desktop's asynchronous discovery path.
      await new Promise((resolve) => setTimeout(resolve, 250));
      respondWithTool(response, "alpha-spawn-beta", "alpha_spawn_beta", "spawn_agent", {
        task_name: "beta",
        fork_turns: "none",
        message: betaInitialMarker,
      });
      return;
    }
    if (!spawnOutput.includes("/root/alpha/beta")) {
      throw new Error(`Nested beta spawn failed: ${spawnOutput}`);
    }
    if (!functionOutput(body, "alpha_wait_beta")) {
      state.alphaPingObserved = inputContains(body, alphaPingMarker);
      respondWithTool(response, "alpha-wait-beta", "alpha_wait_beta", "wait_agent", {
        timeout_ms: 5_000,
      });
      return;
    }
    const serializedInput = JSON.stringify(inputItems(body));
    state.nestedDirectParentEnvelopeObserved =
      serializedInput.includes("/root/alpha/beta") &&
      /Message Type: (?:FINAL_ANSWER|COMPLETED)|completed/iu.test(serializedInput);
    state.alphaCompleted = true;
    respondWithText(response, "alpha-child", "alpha initial complete");
    return;
  }
  if (inputContains(body, rootRollbackMarker)) {
    handleRollbackRoot(body, response, state);
    return;
  }
  if (inputContains(body, rootCountMarker)) {
    await handleCountRoot(body, response, state);
    return;
  }
  if (inputContains(body, rootFlowMarker)) {
    handleFlowRoot(body, response, state);
    return;
  }
  if (inputContains(body, durableRootVerifyMarker)) {
    handleDurableRootVerify(body, response, state);
    return;
  }
  if (inputContains(body, durableRootRecoverMarker)) {
    handleDurableRootRecover(body, response, state);
    return;
  }
  if (inputContains(body, durableRootPrepareMarker)) {
    handleDurableRootPrepare(body, response, state);
    return;
  }
  throw new Error(
    `Semantic mock received an unclassified request: ${JSON.stringify(body).slice(0, 1_000)}`,
  );
}

async function startSemanticServer(state: SemanticState): Promise<{
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}> {
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((request, response) => {
    void handleSemanticRequest(request, response, state).catch((error: unknown) => {
      process.stderr.write(
        `Semantic mock failure: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      if (response.destroyed) return;
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      );
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Semantic server did not bind");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function waitForTurnCompletion(client: CodexProbeClient, threadId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for semantic turn on ${threadId}`));
    }, requestTimeoutMs);
    const listener = (notification: ServerNotification): void => {
      if (notification.method !== "turn/completed") return;
      const params: unknown = notification.params;
      if (!isRecord(params) || params.threadId !== threadId) return;
      cleanup();
      const turn = isRecord(params.turn) ? params.turn : {};
      if (turn.status !== "completed") {
        reject(new Error(`Semantic turn failed: ${JSON.stringify(turn.error ?? turn)}`));
        return;
      }
      resolve();
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      client.off("notification", listener);
    };
    client.on("notification", listener);
  });
}

async function probeMultiAgentPromise(
  input: { readonly binaryPath: string; readonly outputPath?: string },
  callbacks: ScopedCallbackRuntime["Service"],
): Promise<AgentRuntimeMultiAgentConformanceReport> {
  const state: SemanticState = {
    alphaCompleted: false,
    alphaInterruptRequestAborted: false,
    alphaInterruptRequestStarted: false,
    alphaPingObserved: false,
    betaCompleted: false,
    betaEvictedObserved: false,
    betaReloadObserved: false,
    countChildRequestAborted: false,
    countChildRequestStarted: false,
    countMailboxAccepted: 0,
    countPhase: 0,
    countTypedOverflowObserved: false,
    durableChildCompleted: false,
    durableParentEnvelopeObserved: false,
    durableParentRecoveredMarkerCount: 0,
    durableParentPhase: 0,
    durableParentVerifiedAfterRestart: false,
    durableParentVerifiedMarkerCount: 0,
    durableRootPreparePhase: 0,
    durableRootRecoverPhase: 0,
    durableRootVerifyPhase: 0,
    flowPhase: 0,
    gammaCompleted: false,
    nestedDirectParentEnvelopeObserved: false,
    rollbackPhase: 0,
    rollbackTypedOverflowObserved: false,
  };
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "nodex-agent-runtime-semantic-"));
  const stateHome = path.join(temporaryRoot, "home");
  const cwd = path.join(temporaryRoot, "workspace");
  mkdirSync(stateHome, { recursive: true, mode: 0o700 });
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const server = await startSemanticServer(state);
  let observedSubagentActivityEvents = 0;
  try {
    await callbacks.runPromise(
      withCodexProbeSession(
        callbacks,
        {
          binaryPath: input.binaryPath,
          requestTimeout: requestTimeoutMs,
          expectedCodexHome: stateHome,
          env: {
            ...process.env,
            INTERPRETER_HOME: stateHome,
            NODEX_SEMANTIC_API_KEY: "nodex-semantic-secret",
          },
          clientInfo: {
            name: "nodex-agent-runtime-semantic-conformance",
            title: "Nodex Agent Runtime Semantic Conformance",
            version: "1.0.0",
          },
        },
        async (client) => {
          const listener = (notification: ServerNotification): void => {
            const params: unknown = notification.params;
            const item = isRecord(params) && isRecord(params.item) ? params.item : null;
            if (item?.type === "subAgentActivity") {
              observedSubagentActivityEvents += 1;
            }
          };
          client.on("notification", listener);
          try {
            const providerId = "nodex-semantic-provider";
            const providerConfig = {
              name: providerId,
              base_url: server.baseUrl,
              env_key: "NODEX_SEMANTIC_API_KEY",
              wire_api: "responses",
              request_max_retries: 0,
              stream_max_retries: 0,
            };
            const config = {
              [`model_providers.${providerId}`]: providerConfig,
              "features.plugins": false,
              "features.code_mode": false,
              "features.code_mode_only": false,
              "agents.enabled": true,
              "features.multi_agent_v2": {
                enabled: true,
                max_concurrent_threads_per_session: 3,
                min_wait_timeout_ms: 0,
                default_wait_timeout_ms: 5_000,
                max_wait_timeout_ms: 5_000,
                tool_namespace: namespace,
                expose_spawn_agent_model_overrides: true,
                wait_agent_enabled: true,
                non_code_mode_only: false,
              },
            };
            const run = async (marker: string): Promise<void> => {
              const thread = await client.request("thread/start", {
                ephemeral: false,
                model: "gpt-5.6-sol",
                modelProvider: providerId,
                cwd,
                approvalPolicy: "never",
                sandbox: "danger-full-access",
                config,
              });
              if (
                !isRecord(thread) ||
                !isRecord(thread.thread) ||
                typeof thread.thread.id !== "string"
              ) {
                throw new Error("Semantic probe received an invalid thread/start response");
              }
              const completion = waitForTurnCompletion(client, thread.thread.id);
              await client.request("turn/start", {
                threadId: thread.thread.id,
                input: [{ type: "text", text: marker, text_elements: [] }],
              });
              await completion;
            };
            await run(rootCountMarker);
            await run(rootRollbackMarker);
            await run(rootFlowMarker);
          } finally {
            client.off("notification", listener);
          }
        },
      ),
    );
    const durableProviderId = "nodex-semantic-provider";
    const durableConfig = {
      [`model_providers.${durableProviderId}`]: {
        name: durableProviderId,
        base_url: server.baseUrl,
        env_key: "NODEX_SEMANTIC_API_KEY",
        wire_api: "responses",
        request_max_retries: 0,
        stream_max_retries: 0,
      },
      "features.plugins": false,
      "features.code_mode": false,
      "features.code_mode_only": false,
      "agents.enabled": true,
      "features.multi_agent_v2": {
        enabled: true,
        max_concurrent_threads_per_session: 3,
        min_wait_timeout_ms: 0,
        default_wait_timeout_ms: 5_000,
        max_wait_timeout_ms: 5_000,
        tool_namespace: namespace,
        expose_spawn_agent_model_overrides: true,
        wait_agent_enabled: true,
        non_code_mode_only: false,
      },
    };
    const durableSessionOptions = {
      binaryPath: input.binaryPath,
      requestTimeout: requestTimeoutMs,
      expectedCodexHome: stateHome,
      env: {
        ...process.env,
        INTERPRETER_HOME: stateHome,
        NODEX_SEMANTIC_API_KEY: "nodex-semantic-secret",
      },
      clientInfo: {
        name: "nodex-agent-runtime-durable-completion-conformance",
        title: "Nodex Agent Runtime Durable Completion Conformance",
        version: "1.0.0",
      },
    } as const;
    const attachActivityListener = (client: CodexProbeClient): (() => void) => {
      const listener = (notification: ServerNotification): void => {
        const params: unknown = notification.params;
        const item = isRecord(params) && isRecord(params.item) ? params.item : null;
        if (item?.type === "subAgentActivity") observedSubagentActivityEvents += 1;
      };
      client.on("notification", listener);
      return () => client.off("notification", listener);
    };

    const first = await callbacks.runPromise(
      openCodexProbeSession(callbacks, durableSessionOptions),
    );
    let durableRootThreadId: string;
    const detachFirst = attachActivityListener(first);
    try {
      const thread = await first.request("thread/start", {
        ephemeral: false,
        model: "gpt-5.6-sol",
        modelProvider: durableProviderId,
        cwd,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        config: durableConfig,
      });
      if (!isRecord(thread) || !isRecord(thread.thread) || typeof thread.thread.id !== "string") {
        throw new Error("Durable completion probe received an invalid thread/start response");
      }
      durableRootThreadId = thread.thread.id;
      const completion = waitForTurnCompletion(first, durableRootThreadId);
      await first.request("turn/start", {
        threadId: durableRootThreadId,
        input: [{ type: "text", text: durableRootPrepareMarker, text_elements: [] }],
      });
      await completion;
    } finally {
      detachFirst();
      await first.stop();
    }

    const second = await callbacks.runPromise(
      openCodexProbeSession(callbacks, durableSessionOptions),
    );
    const detachSecond = attachActivityListener(second);
    try {
      const resumed = await second.request("thread/resume", {
        threadId: durableRootThreadId,
        excludeTurns: true,
        model: "gpt-5.6-sol",
        modelProvider: durableProviderId,
        cwd,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        config: durableConfig,
      });
      if (!isRecord(resumed) || !isRecord(resumed.thread)) {
        throw new Error("Durable completion probe received an invalid thread/resume response");
      }
      const completion = waitForTurnCompletion(second, durableRootThreadId);
      await second.request("turn/start", {
        threadId: durableRootThreadId,
        input: [{ type: "text", text: durableRootRecoverMarker, text_elements: [] }],
      });
      await completion;
    } finally {
      detachSecond();
      await second.stop();
    }

    const third = await callbacks.runPromise(
      openCodexProbeSession(callbacks, durableSessionOptions),
    );
    const detachThird = attachActivityListener(third);
    try {
      const resumed = await third.request("thread/resume", {
        threadId: durableRootThreadId,
        excludeTurns: true,
        model: "gpt-5.6-sol",
        modelProvider: durableProviderId,
        cwd,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        config: durableConfig,
      });
      if (!isRecord(resumed) || !isRecord(resumed.thread)) {
        throw new Error(
          "Durable completion uniqueness probe received an invalid thread/resume response",
        );
      }
      const completion = waitForTurnCompletion(third, durableRootThreadId);
      await third.request("turn/start", {
        threadId: durableRootThreadId,
        input: [{ type: "text", text: durableRootVerifyMarker, text_elements: [] }],
      });
      await completion;
    } finally {
      detachThird();
      await third.stop();
    }
    if (state.rollbackPhase !== 4 || !state.rollbackTypedOverflowObserved) {
      throw new Error(`Rollback scenario was incomplete: ${JSON.stringify(state)}`);
    }
    if (
      state.countPhase !== 4 ||
      !state.countTypedOverflowObserved ||
      state.countMailboxAccepted !== 256 ||
      !state.countChildRequestStarted ||
      !state.countChildRequestAborted
    ) {
      throw new Error(`Mailbox count scenario was incomplete: ${JSON.stringify(state)}`);
    }
    if (
      state.flowPhase !== 18 ||
      !state.alphaCompleted ||
      !state.alphaPingObserved ||
      !state.betaCompleted ||
      !state.betaEvictedObserved ||
      !state.betaReloadObserved ||
      !state.gammaCompleted ||
      !state.nestedDirectParentEnvelopeObserved ||
      !state.alphaInterruptRequestStarted ||
      !state.alphaInterruptRequestAborted
    ) {
      throw new Error(`Multi-agent semantic scenario was incomplete: ${JSON.stringify(state)}`);
    }
    if (
      state.durableRootPreparePhase !== 6 ||
      state.durableRootRecoverPhase !== 3 ||
      state.durableRootVerifyPhase !== 3 ||
      state.durableParentPhase !== 3 ||
      !state.durableChildCompleted ||
      !state.durableParentEnvelopeObserved ||
      state.durableParentRecoveredMarkerCount !== 1 ||
      !state.durableParentVerifiedAfterRestart ||
      state.durableParentVerifiedMarkerCount !== 1
    ) {
      throw new Error(`Durable completion scenario was incomplete: ${JSON.stringify(state)}`);
    }
    const report: AgentRuntimeMultiAgentConformanceReport = {
      binaryPath: path.resolve(input.binaryPath),
      capabilities: {
        cleanup: "pass",
        completionDeliveryAndNestedDirectParent: "pass",
        durableCompletionReplayAfterRestart: "pass",
        followupAfterInterruptReuse: "pass",
        interruptListAndWait: "pass",
        mailboxCountAndByteCapacity: "pass",
        residencyEvictionAndReload: "pass",
        sendMessage: "pass",
        spawnRollback: "pass",
        spawnSuccess: "pass",
      },
      durableCompletionEvidence: {
        firstRecoveryOccurrences: state.durableParentRecoveredMarkerCount,
        secondRestartOccurrences: state.durableParentVerifiedMarkerCount,
      },
      generatedAt: new Date().toISOString(),
      observedSubagentActivityEvents,
    };
    if (input.outputPath) {
      mkdirSync(path.dirname(input.outputPath), { recursive: true });
      writeFileSync(input.outputPath, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    }
    return report;
  } finally {
    await server.close();
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

export const probeAgentRuntimeMultiAgent = (input: {
  readonly binaryPath: string;
  readonly outputPath?: string;
}): Effect.Effect<
  AgentRuntimeMultiAgentConformanceReport,
  Cause.UnknownError,
  ScopedCallbackRuntime
> =>
  Effect.gen(function* () {
    const callbacks = yield* ScopedCallbackRuntime;
    return yield* Effect.tryPromise(() => probeMultiAgentPromise(input, callbacks));
  });

function readOption(argv: string[], option: string): string | null {
  const index = argv.indexOf(option);
  if (index < 0) return null;
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

const main = Effect.gen(function* () {
  const argv = process.argv.slice(2);
  const runtime = resolveCodexRuntime({ isPackaged: false, projectRootPath: projectRoot });
  const binaryPath = path.resolve(readOption(argv, "--binary") ?? runtime.binaryPath);
  const outputPath = path.resolve(
    readOption(argv, "--out") ??
      path.join(projectRoot, ".generated", "agent-runtime-conformance", "multi-agent.json"),
  );
  const report = yield* probeAgentRuntimeMultiAgent({ binaryPath, outputPath });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCodexProbeMain(main);
}
