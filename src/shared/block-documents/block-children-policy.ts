import manifestJson from "./block-children-policy-v1.json";

export type BlockChildrenLayout =
  | "indented"
  | "disclosure"
  | "enclosed"
  | "atomic"
  | "marker"
  | "resource";

export type BlockChildrenAcceptance =
  | { readonly kind: "always" }
  | { readonly kind: "never" }
  | { readonly kind: "booleanProp"; readonly prop: "isToggleable" };

export interface BlockChildrenRule {
  readonly acceptance: BlockChildrenAcceptance;
  readonly layout: BlockChildrenLayout;
}

export interface BlockChildrenNode {
  readonly type: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children: readonly BlockChildrenNode[];
}

export interface NormalizedBlockForest<TBlock> {
  readonly blocks: readonly TBlock[];
  readonly changed: boolean;
  readonly liftedRoots: number;
}

export class BlockChildrenContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockChildrenContractError";
  }
}

const ACCEPTANCE_VALUES = new Set(["always", "never", "booleanProp"]);
const LAYOUT_VALUES = new Set<BlockChildrenLayout>([
  "indented",
  "disclosure",
  "enclosed",
  "atomic",
  "marker",
  "resource",
]);

const parseRule = (type: string, value: unknown): BlockChildrenRule => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BlockChildrenContractError(`Block ${type} has an invalid children rule`);
  }

  const record = value as Readonly<Record<string, unknown>>;
  const acceptance = record.acceptance;
  const layout = record.layout;
  if (typeof acceptance !== "string" || !ACCEPTANCE_VALUES.has(acceptance)) {
    throw new BlockChildrenContractError(`Block ${type} has invalid children acceptance`);
  }
  if (typeof layout !== "string" || !LAYOUT_VALUES.has(layout as BlockChildrenLayout)) {
    throw new BlockChildrenContractError(`Block ${type} has invalid children layout`);
  }

  if (acceptance === "booleanProp") {
    if (record.prop !== "isToggleable") {
      throw new BlockChildrenContractError(
        `Block ${type} has unsupported conditional children property`,
      );
    }
    return {
      acceptance: { kind: "booleanProp", prop: "isToggleable" },
      layout: layout as BlockChildrenLayout,
    };
  }

  if (record.prop !== undefined) {
    throw new BlockChildrenContractError(
      `Block ${type} has a children property without conditional acceptance`,
    );
  }
  return {
    acceptance: { kind: acceptance === "always" ? "always" : "never" },
    layout: layout as BlockChildrenLayout,
  };
};

const parseManifest = (value: unknown): Readonly<Record<string, BlockChildrenRule>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BlockChildrenContractError("Block children manifest must be an object");
  }
  const manifest = value as Readonly<Record<string, unknown>>;
  if (manifest.contractVersion !== 1) {
    throw new BlockChildrenContractError("Unsupported block children contract version");
  }
  if (
    typeof manifest.current !== "object" ||
    manifest.current === null ||
    Array.isArray(manifest.current)
  ) {
    throw new BlockChildrenContractError("Block children manifest is missing current rules");
  }

  return Object.freeze(
    Object.fromEntries(
      Object.entries(manifest.current).map(([type, rule]) => [type, parseRule(type, rule)]),
    ),
  );
};

export const BLOCK_CHILDREN_RULES = parseManifest(manifestJson);
export const CURRENT_BLOCK_TYPES = Object.freeze(Object.keys(BLOCK_CHILDREN_RULES));

export const getBlockChildrenRule = (type: string): BlockChildrenRule => {
  const rule = BLOCK_CHILDREN_RULES[type];
  if (rule) return rule;
  throw new BlockChildrenContractError(`Unsupported current Block type ${type}`);
};

export const acceptsBlockChildren = (block: Pick<BlockChildrenNode, "type" | "props">): boolean => {
  const acceptance = getBlockChildrenRule(block.type).acceptance;
  if (acceptance.kind === "always") return true;
  if (acceptance.kind === "never") return false;
  return block.props?.[acceptance.prop] === true;
};

type BlockChildrenPredicate<TBlock> = (block: TBlock) => boolean;

export const normalizeBlockChildrenForest = <TBlock extends BlockChildrenNode>(
  blocks: readonly TBlock[],
  acceptsChildren: BlockChildrenPredicate<TBlock> = acceptsBlockChildren,
): NormalizedBlockForest<TBlock> => {
  interface ArenaNode {
    readonly original: TBlock;
    readonly children: number[];
  }
  interface PendingNode {
    readonly block: TBlock;
    readonly target: number[];
    readonly rejectedAncestorDepth: number;
  }

  const arena: ArenaNode[] = [];
  const rootIndices: number[] = [];
  const pending: PendingNode[] = [];
  let liftedRoots = 0;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    pending.push({ block: blocks[index]!, target: rootIndices, rejectedAncestorDepth: 0 });
  }

  while (pending.length > 0) {
    const entry = pending.pop()!;
    const arenaIndex = arena.length;
    const normalizedChildren: number[] = [];
    arena.push({ original: entry.block, children: normalizedChildren });
    entry.target.push(arenaIndex);
    liftedRoots += entry.rejectedAncestorDepth;

    const canOwnChildren = acceptsChildren(entry.block);
    const childTarget = canOwnChildren ? normalizedChildren : entry.target;
    const childRejectedDepth = canOwnChildren ? 0 : entry.rejectedAncestorDepth + 1;
    const children = entry.block.children as readonly TBlock[];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({
        block: children[index]!,
        target: childTarget,
        rejectedAncestorDepth: childRejectedDepth,
      });
    }
  }

  const normalizedByIndex = new Array<TBlock>(arena.length);
  for (let index = arena.length - 1; index >= 0; index -= 1) {
    const entry = arena[index]!;
    const normalizedChildren = entry.children.map((childIndex) => normalizedByIndex[childIndex]!);
    const originalChildren = entry.original.children;
    const childrenUnchanged =
      originalChildren.length === normalizedChildren.length &&
      originalChildren.every((child, childIndex) => child === normalizedChildren[childIndex]);
    normalizedByIndex[index] = childrenUnchanged
      ? entry.original
      : ({ ...entry.original, children: normalizedChildren } as TBlock);
  }

  const normalized = rootIndices.map((index) => normalizedByIndex[index]!);
  const changed =
    blocks.length !== normalized.length ||
    blocks.some((block, index) => block !== normalized[index]);
  return {
    blocks: changed ? normalized : blocks,
    changed,
    liftedRoots,
  };
};

export const assertBlockChildrenContract = (blocks: readonly BlockChildrenNode[]): void => {
  const pending = [...blocks];
  while (pending.length > 0) {
    const block = pending.pop()!;
    if (!acceptsBlockChildren(block) && block.children.length > 0) {
      throw new BlockChildrenContractError(
        `Block ${block.type} must not contain generic child Blocks`,
      );
    }
    for (const child of block.children) pending.push(child);
  }
};
