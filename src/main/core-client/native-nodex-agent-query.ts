import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../../shared/database-module-v2";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
} from "../../shared/database-identities";
import { parseDatabaseModuleReadResultV2 } from "../../shared/database-module-v2-transport";
import type {
  NodexAgentV3ReadCommandResult,
  NodexAgentV3ReadRequest,
} from "../../shared/nodex-agent-tools";
import { QueryDatabaseV3OutputSchema } from "../../shared/nodex-agent-tools/v3-read-schemas";
import { projectNodexAgentQueryV3Data } from "../agent-tools/query-v3-projection";
import { projectCoreDatabaseViewQuery } from "../../shared/database-page-projection";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";
import { createCoreDatabaseModuleAdapter } from "./database-module-adapter";

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
    const authority = request.authority;
    const authorization = toCoreAgentExecutionAuthorization(
      runtime.identity.profileId,
      authority,
      request.callId ?? `nodex-agent:${request.tool}`,
      request.resourceAccess,
    );
    const agentQuery = {
      authorization,
      cursor: request.input.page?.cursor ?? null,
      limit: request.input.page?.limit ?? null,
    };
    const snapshot = await runtime.clientForProject(request.projectId).databaseRead(
      request.tool === "query_database_view"
        ? {
            kind: "agent_view_query",
            view_id: request.input.viewId,
            query: agentQuery,
          }
        : {
            kind: "agent_data_source_query",
            data_source_id: request.input.dataSourceId,
            query: agentQuery,
          },
    );
    if (snapshot.value.kind !== "agent_query") {
      throw new Error("Core returned the wrong Agent Database query variant");
    }
    const window = snapshot.value.value;
    const descriptorAdapter = createCoreDatabaseModuleAdapter({
      client: runtime.clientForProject(request.projectId),
      projectId: request.projectId,
      libraryId: authority.libraryId,
      storeEpoch: snapshot.store_epoch,
    });
    const descriptors = await Promise.all([
      descriptorAdapter.read({
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: request.projectId,
        read: {
          target: {
            kind: "database",
            databaseId: parseDatabaseId(window.database_id),
          },
          mode: "database",
        },
      }),
      descriptorAdapter.read({
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: request.projectId,
        read: {
          target: {
            kind: "data_source",
            dataSourceId: parseDataSourceId(window.data_source_id),
          },
          mode: "data_source",
        },
      }),
      descriptorAdapter.read({
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: request.projectId,
        read: {
          target: {
            kind: "view",
            viewId: parseDatabaseViewId(window.view_id),
          },
          mode: "view",
        },
      }),
    ]);
    const [databaseResult, sourceResult, viewResult] = descriptors;
    if (
      !databaseResult?.ok
      || databaseResult.value.value.kind !== "database"
      || !sourceResult?.ok
      || sourceResult.value.value.kind !== "data_source"
      || !viewResult?.ok
      || viewResult.value.value.kind !== "view"
    ) {
      throw new Error("Core returned an incompatible Agent Database descriptor");
    }
    const queryValue = projectCoreDatabaseViewQuery(
      window,
      authority.libraryId,
      databaseResult.value.value.value,
      sourceResult.value.value.value,
      viewResult.value.value.value,
    );
    const dataSourceQueryValue = {
      database: queryValue.database,
      dataSource: queryValue.dataSource,
      properties: queryValue.properties,
      rows: queryValue.rows,
    };
    const parsed = parseDatabaseModuleReadResultV2({
      ok: true,
      value: {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: request.projectId,
        libraryId: authority.libraryId,
        storeEpoch: snapshot.store_epoch,
        commitSeq: snapshot.commit_head,
        authorization: snapshot.authorization,
        value: {
          kind: request.tool === "query_database_view"
            ? "query"
            : "data_source_query",
          value: request.tool === "query_database_view"
            ? queryValue
            : dataSourceQueryValue,
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
          hasMore: window.rows.next_cursor !== null,
          ...(window.rows.next_cursor
            ? { nextCursor: window.rows.next_cursor }
            : {}),
        },
      }),
    };
  } catch (error) {
    return { ok: false, error: mapNativeNodexAgentCoreError(error) };
  }
}
