import type Database from "better-sqlite3";
import { NFM_AGENT_GUIDE } from "../../shared/nfm/agent-guide";
import {
  GetContextOutputSchema,
  type GetContextInput,
  type GetContextOutput,
  type NodexAgentAccess,
} from "../../shared/nodex-agent-tools";
import { readGeneralDatabaseCatalog } from "../local-store/database-query";
import { mintRevision, requireProject } from "./read-support";

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
      schemaVersion: 1,
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
    schemaVersion: 1,
    data: {
      project: { projectId: input.projectId, name: projectName },
      access: input.access,
      ...(catalog ? {
        databases: catalog.databases.map((descriptor) => ({
          databaseBlockId: descriptor.database.blockId,
          name: descriptor.database.name,
          isPrimary: descriptor.database.isPrimary,
          schemaRevision: mintRevision(database, {
            kind: "database_schema",
            projectId: input.projectId as string,
            subject: [descriptor.database.blockId],
            state: { revision: descriptor.database.schemaRevision },
          }),
          views: descriptor.views
            .filter((view) => view.lifecycle === "active")
            .map((view) => ({
              viewId: view.id,
              name: view.name,
              kind: view.kind,
              isPrimary: view.isPrimary,
              revision: mintRevision(database, {
                kind: "view",
                projectId: input.projectId as string,
                subject: [view.id],
                state: {
                  databaseBlockId: view.databaseBlockId,
                  revision: view.revision,
                },
              }),
            })),
        })),
      } : {}),
      ...(input.request.include?.nfmGuide ? { nfmGuide: NFM_AGENT_GUIDE } : {}),
    },
  });
}
