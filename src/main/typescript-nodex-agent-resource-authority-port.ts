import { getDb } from "./local-store/database";
import {
  persistNodexAgentProjectResourceGrantsInDatabase,
  planNodexAgentResourceAccessInDatabase,
} from "./local-store/project-resource-grants";
import type { NodexAgentResourceAuthorityPort } from "./nodex-agent-resource-authority-port";

export interface TypeScriptNodexAgentResourceAuthorityPortInput {
  readonly persistProjectGrants?: NodexAgentResourceAuthorityPort[
    "persistProjectGrants"
  ];
}

export const createTypeScriptNodexAgentResourceAuthorityPort = (
  input: TypeScriptNodexAgentResourceAuthorityPortInput = {},
): NodexAgentResourceAuthorityPort => ({
  plan: async (request) => planNodexAgentResourceAccessInDatabase(getDb(), request),
  persistProjectGrants: input.persistProjectGrants
    ?? (async (request) => {
      persistNodexAgentProjectResourceGrantsInDatabase(getDb(), request);
    }),
});
