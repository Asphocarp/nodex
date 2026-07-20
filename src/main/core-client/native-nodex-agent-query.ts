import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../../shared/database-module-v2";
import { parseDatabaseModuleReadResultV2 } from "../../shared/database-module-v2-transport";
import type {
  NodexAgentV3ReadCommandResult,
  NodexAgentV3ReadRequest,
} from "../../shared/nodex-agent-tools";
import { QueryDatabaseV3OutputSchema } from "../../shared/nodex-agent-tools/v3-read-schemas";
import { projectNodexAgentQueryV3Data } from "../agent-tools/query-v3-projection";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";

type QueryRequest = Extract<NodexAgentV3ReadRequest, {
  readonly tool: "query_database_view" | "query_data_source";
}>;

export async function readNativeDatabaseQuery(
  request: QueryRequest,
  runtime: RustDataAuthorityRuntime,
): Promise<NodexAgentV3ReadCommandResult> {
  if (!request.authority) {
    return {
      ok: false,
      error: {
        code: "authorization_denied",
        message: "Native Agent Database query requires exact Turn authority",
        retryable: false,
        recovery: "start_new_task",
      },
    };
  }
  try {
    const authorization = toCoreAgentExecutionAuthorization(
      runtime.rootClient.handshake.profile_id,
      request.authority,
      request.callId ?? `nodex-agent:${request.tool}`,
      request.resourceAccess,
    );
    const agentQuery = {
      authorization,
      cursor: request.input.page?.cursor ?? null,
      limit: request.input.page?.limit ?? null,
    };
    const snapshot = await runtime.clientForProject(request.projectId).databaseRead({
      target: request.tool === "query_database_view"
        ? {
            kind: "agent_view",
            view_id: request.input.viewId,
            query: agentQuery,
          }
        : {
            kind: "agent_data_source",
            data_source_id: request.input.dataSourceId,
            query: agentQuery,
          },
      mode: "query",
      filter: request.tool === "query_data_source"
        ? request.input.filter ?? null
        : null,
      sort: request.tool === "query_data_source"
        ? request.input.sort ?? null
        : null,
    });
    if (snapshot.value.kind !== "agent_query") {
      throw new Error("Core returned the wrong Agent Database query variant");
    }
    const parsed = parseDatabaseModuleReadResultV2({
      ok: true,
      value: {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: request.projectId,
        libraryId: request.authority.libraryId,
        storeEpoch: snapshot.store_epoch,
        changeLogSeq: snapshot.event_head,
        value: {
          kind: request.tool === "query_database_view"
            ? "query"
            : "data_source_query",
          value: snapshot.value.value,
        },
      },
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const query = parsed.value.value;
    if (query.kind !== "query" && query.kind !== "data_source_query") {
      throw new Error("Core returned an incompatible Agent Database projection");
    }
    return {
      ok: true,
      tool: request.tool,
      output: QueryDatabaseV3OutputSchema.parse({
        data: projectNodexAgentQueryV3Data(query, request.input.select),
        page: {
          hasMore: snapshot.value.has_more,
          ...(snapshot.value.next_cursor
            ? { nextCursor: snapshot.value.next_cursor }
            : {}),
        },
      }),
    };
  } catch (error) {
    return { ok: false, error: mapNativeNodexAgentCoreError(error) };
  }
}
