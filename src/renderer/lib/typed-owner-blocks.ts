export const TYPED_OWNER_BLOCK_TYPES = ["page", "database", "canvas"] as const;

export type TypedOwnerBlockType = (typeof TYPED_OWNER_BLOCK_TYPES)[number];

export interface TypedOwnerBlockLike {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly children?: readonly TypedOwnerBlockLike[];
}

export interface TypedOwnerDocumentChange<T extends TypedOwnerBlockLike = TypedOwnerBlockLike> {
  readonly type: "insert" | "delete" | "update" | "move";
  readonly block: T;
  readonly prevBlock?: T;
  readonly prevParent?: T;
  readonly currentParent?: T;
  readonly crossedBlocks?: readonly T[];
  readonly source: {
    readonly type: "local" | "paste" | "drop" | "undo" | "redo" | "undo-redo" | "yjs-remote";
  };
}

export type TypedOwnerDocumentChangeDecision =
  | { readonly kind: "allow" }
  | {
      readonly kind: "forbidden";
      readonly reason: "generic_typed_owner_mutation";
    };

export const isTypedOwnerBlockType = (type: unknown): type is TypedOwnerBlockType =>
  typeof type === "string" && (TYPED_OWNER_BLOCK_TYPES as readonly string[]).includes(type);

export const hasTypedOwnerBlock = (blocks: readonly TypedOwnerBlockLike[]): boolean =>
  blocks.some(
    (block) => isTypedOwnerBlockType(block.type) || hasTypedOwnerBlock(block.children ?? []),
  );

export const hasNestedTypedOwnerBlock = (blocks: readonly TypedOwnerBlockLike[]): boolean =>
  blocks.some(
    (block) => !isTypedOwnerBlockType(block.type) && hasTypedOwnerBlock(block.children ?? []),
  );

export const hasTypedOwnerType = (types: readonly unknown[]): boolean =>
  types.some(isTypedOwnerBlockType);

const directTypedOwnerChange = (change: TypedOwnerDocumentChange): boolean =>
  isTypedOwnerBlockType(change.block.type) || isTypedOwnerBlockType(change.prevBlock?.type);

const crossesTypedOwnerSubtree = (change: TypedOwnerDocumentChange): boolean =>
  hasTypedOwnerBlock(change.crossedBlocks ?? []);

const protectedOwnerChange = (change: TypedOwnerDocumentChange): boolean => {
  if (change.type === "update") {
    return directTypedOwnerChange(change) || crossesTypedOwnerSubtree(change);
  }
  return (
    hasTypedOwnerBlock([change.block]) ||
    (change.prevBlock !== undefined && hasTypedOwnerBlock([change.prevBlock])) ||
    isTypedOwnerBlockType(change.currentParent?.type) ||
    crossesTypedOwnerSubtree(change)
  );
};

/**
 * Enforces the renderer side of the typed-owner boundary on the actual BlockNote
 * transaction. Core-authorized lifecycle and transfer commits arrive as remote
 * Yjs changes; every local mutation that touches an owner shell must use a typed
 * operation before it can enter the shared Y.Doc.
 */
export const resolveTypedOwnerDocumentChanges = <T extends TypedOwnerBlockLike>(
  changes: readonly TypedOwnerDocumentChange<T>[],
): TypedOwnerDocumentChangeDecision => {
  if (changes.every((change) => change.source.type === "yjs-remote")) {
    return { kind: "allow" };
  }
  if (!changes.some(protectedOwnerChange)) return { kind: "allow" };
  return { kind: "forbidden", reason: "generic_typed_owner_mutation" };
};
