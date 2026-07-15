import type Database from "better-sqlite3";
import type { BlockLocation, DocumentId } from "../../shared/nodex-agent-tools";
import { NodexAgentReadError } from "./read-support";

export function requireCardDocumentId(
  database: Database.Database,
  projectId: string,
  cardId: string,
): DocumentId {
  const row = database.prepare(
    `
    SELECT ownership.document_id
    FROM blocks card
    INNER JOIN block_documents ownership
      ON ownership.block_id = card.id
     AND ownership.project_id = card.project_id
    WHERE card.id = ?
      AND card.project_id = ?
      AND card.type = 'card'
      AND card.lifecycle <> 'deleted'
    LIMIT 1
  `).get(cardId, projectId) as { readonly document_id: string } | undefined;
  if (row) return row.document_id as DocumentId;
  throw new NodexAgentReadError(
    "not_found",
    `Card ${cardId} was not found in the bound Project`,
    false,
    "none",
    { resourceId: cardId, domainCode: "card_not_found" },
  );
}

export function requireDocumentCardId(
  database: Database.Database,
  projectId: string,
  documentId: string,
): string {
  const row = database.prepare(
    `
    SELECT owner.id
    FROM block_documents ownership
    INNER JOIN blocks owner
      ON owner.id = ownership.block_id
     AND owner.project_id = ownership.project_id
    WHERE ownership.document_id = ?
      AND ownership.project_id = ?
      AND owner.type = 'card'
      AND owner.lifecycle <> 'deleted'
    LIMIT 1
  `).get(documentId, projectId) as { readonly id: string } | undefined;
  if (row) return row.id;
  throw new NodexAgentReadError(
    "unsupported_resource",
    `Document ${documentId} is not owned by a Card`,
    false,
    "none",
    { resourceId: documentId, domainCode: "card_parent_required" },
  );
}

export function toCardLocation(
  database: Database.Database,
  projectId: string,
  location: BlockLocation,
) {
  if (location.kind === "space" || location.kind === "database") return location;
  return {
    kind: "card" as const,
    cardId: requireDocumentCardId(database, projectId, location.documentId),
  };
}
