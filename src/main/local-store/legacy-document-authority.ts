import type {
  BlockLifecycle,
  DocumentReadiness,
} from "../../shared/block-documents/contracts";

/**
 * Persistence-only authority state retained while the shipped-store import tables are
 * removed. Runtime ownership and synchronization dispatch through
 * `OwnedDocumentDescriptor.sync` instead.
 */
export type LegacyDocumentAuthority = "legacy_shadow" | "ydoc_primary";

/** Yjs-shaped import record; never expose across a runtime boundary. */
export interface LegacyOwnedBlockDocumentDescriptor {
  readonly projectId: string;
  readonly ownerBlockId: string;
  readonly ownerType: string;
  readonly ownerLifecycle: BlockLifecycle;
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly schemaKey: string;
  readonly schemaVersion: number;
  readonly readiness: DocumentReadiness;
  readonly authority: LegacyDocumentAuthority;
  readonly stateVector: Uint8Array;
}
