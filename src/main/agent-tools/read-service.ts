import type Database from "better-sqlite3";
import type {
  NodexAgentReadCommandResult,
  NodexAgentReadRequest,
} from "../../shared/nodex-agent-tools";
import { readNodexAgentBlock } from "./read-block";
import { readNodexAgentContext } from "./read-context";
import { readNodexAgentDatabaseQuery } from "./read-query-database";
import { readNodexAgentSearch } from "./read-search";
import { readFailure } from "./read-support";

function dispatchNodexAgentRead(
  database: Database.Database,
  request: NodexAgentReadRequest,
): NodexAgentReadCommandResult {
  switch (request.tool) {
    case "get_context":
      return {
        ok: true,
        tool: request.tool,
        output: readNodexAgentContext(database, {
          projectId: request.projectId,
          access: request.access,
          request: request.input,
        }),
      };
    case "get_block":
      return {
        ok: true,
        tool: request.tool,
        output: readNodexAgentBlock(database, request.projectId, request.input),
      };
    case "search":
      return {
        ok: true,
        tool: request.tool,
        output: readNodexAgentSearch(database, request.projectId, request.input),
      };
    case "query_database":
      return {
        ok: true,
        tool: request.tool,
        output: readNodexAgentDatabaseQuery(database, request.projectId, request.input),
      };
  }
}

/** Capture each read result and any explicitly requested guards inside one SQLite snapshot. */
export function readNodexAgentTool(
  database: Database.Database,
  request: NodexAgentReadRequest,
): NodexAgentReadCommandResult {
  try {
    return database.transaction(
      () => dispatchNodexAgentRead(database, request),
    ).deferred();
  } catch (error) {
    return readFailure(error);
  }
}
