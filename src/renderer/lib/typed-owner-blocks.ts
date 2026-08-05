export const TYPED_OWNER_BLOCK_TYPES = [
  "page",
  "database",
  "canvas",
] as const;

export type TypedOwnerBlockType = (typeof TYPED_OWNER_BLOCK_TYPES)[number];

export interface TypedOwnerBlockLike {
  readonly type?: unknown;
  readonly children?: readonly TypedOwnerBlockLike[];
}

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
