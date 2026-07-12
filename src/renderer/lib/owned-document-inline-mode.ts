import { getOwnedDocumentSchemaRegistration } from "../../shared/block-documents/document-schema-adapters";

export interface OwnedDocumentSchemaIdentity {
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
}

export type OwnedDocumentInlineMode = "block_tree" | "scene_view";

/** Dispatches inline UI from the same exact schema tuple as the authority. */
export const resolveOwnedDocumentInlineMode = (
  identity: OwnedDocumentSchemaIdentity,
): OwnedDocumentInlineMode =>
  getOwnedDocumentSchemaRegistration(identity).contentModel ===
  "block_tree"
    ? "block_tree"
    : "scene_view";
