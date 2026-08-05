export type BlockRecordLifecycle = "active" | "archived" | "retired";

export type BlockRecordKind =
  | "page"
  | "paragraph"
  | "heading"
  | "listItem"
  | "toggle"
  | "quote"
  | "code"
  | "media"
  | "database"
  | "canvas"
  | "reference"
  | (string & {});

export type BlockPlacementParent =
  | { readonly kind: "library"; readonly libraryId: string }
  | { readonly kind: "block"; readonly blockId: string }
  | { readonly kind: "dataSource"; readonly dataSourceId: string };

export interface BlockRecord {
  readonly id: string;
  readonly libraryId: string;
  readonly kind: BlockRecordKind;
  readonly lifecycle: BlockRecordLifecycle;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly contentShardId: string;
  readonly revision: number;
}

export interface BlockPlacement {
  readonly blockId: string;
  readonly parent: BlockPlacementParent;
  readonly rankKey: string;
  readonly revision: number;
}

export type BlockContentSlot = "title" | "inline" | (string & {});

export interface BlockContentSnapshot {
  readonly blockId: string;
  readonly slot: BlockContentSlot;
  readonly content: unknown;
  readonly shardId: string;
  readonly head: number;
}

export interface BlockRecordWindow {
  readonly libraryId: string;
  readonly rootParent: BlockPlacementParent;
  readonly records: readonly BlockRecord[];
  readonly placements: readonly BlockPlacement[];
  readonly content: readonly BlockContentSnapshot[];
  readonly observedLocalCommit: {
    readonly storeEpoch: string;
    readonly commitSeq: number;
  };
  readonly continuation: string | null;
}
