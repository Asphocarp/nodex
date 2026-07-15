import type Database from "better-sqlite3";
import { NFM_AGENT_GUIDE } from "../../shared/nfm/agent-guide";
import {
  GetContextOutputSchema,
  type GetContextInput,
  type GetContextOutput,
  type NodexAgentAccess,
} from "../../shared/nodex-agent-tools";
import { readGeneralDatabaseCatalog } from "../local-store/database-query";
import { requireProject } from "./read-support";

export function readNodexAgentContext(
  database: Database.Database,
  input: {
    readonly projectId: string | null;
    readonly access: NodexAgentAccess;
    readonly request: GetContextInput;
  },
): GetContextOutput {
  if (!input.projectId) {
    return GetContextOutputSchema.parse({
      data: {
        project: null,
        access: input.access,
        ...(input.request.include?.nfmGuide ? { nfmGuide: NFM_AGENT_GUIDE } : {}),
      },
    });
  }

  const projectName = requireProject(database, input.projectId);
  const includeDatabases = input.request.include?.databases === true;
  const catalog = includeDatabases
    ? readGeneralDatabaseCatalog(input.projectId, database)
    : null;
  return GetContextOutputSchema.parse({
    data: {
      project: { projectId: input.projectId, name: projectName },
      access: input.access,
      ...(catalog ? {
        databases: catalog.databases.map((descriptor) => ({
          databaseBlockId: descriptor.database.blockId,
          name: descriptor.database.name,
          isPrimary: descriptor.database.isPrimary,
          views: descriptor.views
            .filter((view) => view.lifecycle === "active")
            .map((view) => ({
              viewId: view.id,
              name: view.name,
              kind: view.kind,
              isPrimary: view.isPrimary,
            })),
        })),
      } : {}),
      ...(input.request.include?.nfmGuide ? { nfmGuide: NFM_AGENT_GUIDE } : {}),
    },
  });
}
