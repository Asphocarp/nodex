import type { DynamicToolCallParams } from "@nodex/codex-app-server-protocol/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "@nodex/codex-app-server-protocol/v2/DynamicToolCallResponse";
import {
  NODEX_APP_TOOL_NAMESPACE,
  type NodexAgentAccess,
  type ToolFailure,
} from "../../shared/nodex-agent-tools";
import {
  NodexAgentDynamicToolFailure,
  type NodexAgentDynamicExecutionContext,
} from "../agent-tools/dynamic-service-core";
import { nodexAgentV3DynamicService } from "../agent-tools/dynamic-service-v3";
import { DynamicToolRegistryError } from "./dynamic-tool-registry";
import { buildNodexAgentV3DynamicToolCatalog } from "./nodex-dynamic-tool-registry";

function buildFailure(
  code: ToolFailure["error"]["code"],
  message: string,
  recovery: ToolFailure["error"]["recovery"],
  retryable = false,
): ToolFailure {
  return {
    error: { code, message, retryable, recovery },
  };
}

function serializeFailure(failure: ToolFailure): DynamicToolCallResponse {
  return {
    contentItems: [{ type: "inputText", text: JSON.stringify(failure) }],
    success: false,
  };
}

function serializeSuccess(output: unknown): DynamicToolCallResponse {
  return {
    contentItems: [{ type: "inputText", text: JSON.stringify(output) }],
    success: true,
  };
}

function mapRegistryFailure(error: DynamicToolRegistryError): ToolFailure {
  const issueSuffix = error.issues.length > 0
    ? `: ${error.issues.join("; ")}`
    : "";
  if (error.code === "invalid_arguments") {
    return buildFailure(
      "invalid_arguments",
      `${error.message}${issueSuffix}`,
      "none",
    );
  }
  if (error.code === "tool_catalog_stale" || error.code === "tool_not_found") {
    return buildFailure(
      "tool_catalog_stale",
      error.message,
      "start_new_task",
    );
  }
  return buildFailure(
    "internal_error",
    "Nodex could not validate the dynamic tool result",
    "retry_same",
    true,
  );
}

export function buildNodexAgentDynamicToolSpecs() {
  return buildNodexAgentV3DynamicToolCatalog();
}

export async function executeNodexAgentDynamicToolCall(
  params: DynamicToolCallParams,
  input: {
    readonly toolsetRevision: number | null;
    readonly projectId: string | null;
    readonly access: NodexAgentAccess;
    readonly authorize: NodexAgentDynamicExecutionContext["authorize"];
  },
): Promise<DynamicToolCallResponse> {
  if (params.namespace !== NODEX_APP_TOOL_NAMESPACE) {
    return serializeFailure(buildFailure(
      "tool_catalog_stale",
      `Unsupported Nodex dynamic tool namespace: ${params.namespace ?? "<none>"}`,
      "start_new_task",
    ));
  }
  if (input.toolsetRevision === null) {
    return serializeFailure(buildFailure(
      "tool_catalog_stale",
      "This task was not launched with the Nodex agent-tool catalog",
      "start_new_task",
    ));
  }

  try {
    const result = await nodexAgentV3DynamicService.registry.execute(
      {
        namespace: NODEX_APP_TOOL_NAMESPACE,
        toolsetRevision: input.toolsetRevision,
        tool: params.tool,
      },
      params.arguments,
      {
        threadId: params.threadId,
        callId: params.callId,
        projectId: input.projectId,
        access: input.access,
        authorize: input.authorize,
      },
    );
    return serializeSuccess(result.output);
  } catch (error) {
    if (error instanceof NodexAgentDynamicToolFailure) {
      return serializeFailure(error.failure);
    }
    if (error instanceof DynamicToolRegistryError) {
      return serializeFailure(mapRegistryFailure(error));
    }
    return serializeFailure(buildFailure(
      "internal_error",
      error instanceof Error ? error.message : "Nodex dynamic tool execution failed",
      "retry_same",
      true,
    ));
  }
}
