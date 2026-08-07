export const TYPED_OWNER_BLOCK_TYPES = [
  "page",
  "database",
  "canvas",
] as const;

export type TypedOwnerBlockType = (typeof TYPED_OWNER_BLOCK_TYPES)[number];

export interface TypedOwnerBlockLike {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly children?: readonly TypedOwnerBlockLike[];
}

export const OWNER_OPERATIONS = [
  "delete",
  "archive",
  "unlink",
  "move",
  "promote",
  "duplicate",
  "copy_paste",
  "replace",
  "reclassify",
] as const;

export type OwnerOperation = (typeof OWNER_OPERATIONS)[number];
export type OwnerBlockKind = "ordinary" | "page" | "database" | "canvas" | "reference";
export type OwnerOperationRoute =
  | "generic_document"
  | "page_lifecycle"
  | "page_copy"
  | "block_transfer"
  | "canvas_lifecycle"
  | "database_lifecycle"
  | "reference_unlink"
  | "forbidden";

export const OWNER_OPERATION_MATRIX = {
  ordinary: {
    delete: "generic_document",
    archive: "forbidden",
    unlink: "forbidden",
    move: "block_transfer",
    promote: "block_transfer",
    duplicate: "generic_document",
    copy_paste: "generic_document",
    replace: "generic_document",
    reclassify: "generic_document",
  },
  page: {
    delete: "page_lifecycle",
    archive: "page_lifecycle",
    unlink: "forbidden",
    move: "block_transfer",
    promote: "forbidden",
    duplicate: "page_copy",
    copy_paste: "forbidden",
    replace: "forbidden",
    reclassify: "forbidden",
  },
  database: {
    delete: "forbidden",
    archive: "database_lifecycle",
    unlink: "forbidden",
    move: "database_lifecycle",
    promote: "forbidden",
    duplicate: "forbidden",
    copy_paste: "forbidden",
    replace: "forbidden",
    reclassify: "forbidden",
  },
  canvas: {
    delete: "canvas_lifecycle",
    archive: "forbidden",
    unlink: "forbidden",
    move: "canvas_lifecycle",
    promote: "forbidden",
    duplicate: "canvas_lifecycle",
    copy_paste: "forbidden",
    replace: "forbidden",
    reclassify: "forbidden",
  },
  reference: {
    delete: "reference_unlink",
    archive: "forbidden",
    unlink: "reference_unlink",
    move: "generic_document",
    promote: "forbidden",
    duplicate: "generic_document",
    copy_paste: "generic_document",
    replace: "generic_document",
    reclassify: "generic_document",
  },
} as const satisfies Record<
  OwnerBlockKind,
  Record<OwnerOperation, OwnerOperationRoute>
>;

export const ownerBlockKind = (type: unknown): OwnerBlockKind => {
  if (type === "page") return "page";
  if (type === "database") return "database";
  if (type === "canvas") return "canvas";
  if (type === "pageRef") return "reference";
  return "ordinary";
};

export const ownerOperationRoute = (
  type: unknown,
  operation: OwnerOperation,
): OwnerOperationRoute => OWNER_OPERATION_MATRIX[ownerBlockKind(type)][operation];

export type OwnerSelectionDecision<T extends TypedOwnerBlockLike> =
  | { readonly kind: "generic" }
  | {
    readonly kind: "typed";
    readonly block: T;
    readonly route: Exclude<OwnerOperationRoute, "generic_document" | "forbidden">;
  }
  | { readonly kind: "forbidden"; readonly reason: "nested_owner" | "mixed_selection" | "unsupported" };

export const resolveOwnerSelectionOperation = <T extends TypedOwnerBlockLike>(
  blocks: readonly T[],
  operation: OwnerOperation,
): OwnerSelectionDecision<T> => {
  if (hasNestedTypedOwnerBlock(blocks)) {
    return { kind: "forbidden", reason: "nested_owner" };
  }
  const owners = typedOwnerBlocks(blocks);
  if (owners.length === 0) return { kind: "generic" };
  if (owners.length !== 1 || blocks.length !== 1) {
    return { kind: "forbidden", reason: "mixed_selection" };
  }
  const block = owners[0];
  if (!block) return { kind: "forbidden", reason: "unsupported" };
  const route = ownerOperationRoute(block.type, operation);
  if (route === "forbidden" || route === "generic_document") {
    return { kind: "forbidden", reason: "unsupported" };
  }
  return { kind: "typed", block, route };
};

export const isTypedOwnerBlockType = (
  type: unknown,
): type is TypedOwnerBlockType =>
  typeof type === "string"
  && (TYPED_OWNER_BLOCK_TYPES as readonly string[]).includes(type);

export const hasTypedOwnerBlock = (
  blocks: readonly TypedOwnerBlockLike[],
): boolean => blocks.some((block) =>
  isTypedOwnerBlockType(block.type)
  || hasTypedOwnerBlock(block.children ?? []));

export const hasNestedTypedOwnerBlock = (
  blocks: readonly TypedOwnerBlockLike[],
): boolean => blocks.some((block) =>
  !isTypedOwnerBlockType(block.type)
  && hasTypedOwnerBlock(block.children ?? []));

export const hasTypedOwnerType = (types: readonly unknown[]): boolean =>
  types.some(isTypedOwnerBlockType);

export const typedOwnerBlocks = <T extends TypedOwnerBlockLike>(
  blocks: readonly T[],
): T[] => blocks.filter((block) => isTypedOwnerBlockType(block.type));
