import { createContext, useContext, type ReactNode } from "react";

export interface BlockReferenceHostRuntime {
  readonly projectId: string;
  readonly projectName: string | null;
  readonly projectWorkspacePath: string | null;
  readonly hostCardId: string | null;
  /**
   * Card Documents already open in this inline expansion chain, including
   * `hostCardId`. A reference may still open a matching Card in the Stage, but
   * must never mount its Document recursively inside this chain.
   */
  readonly ancestorCardIds: readonly string[];
  /**
   * Every independently synchronized owner already open in this inline
   * expansion chain. Unlike `ancestorCardIds`, this also includes Synced,
   * Template, and Large Document owners so reference cycles cannot recursively
   * mount providers.
   */
  readonly ancestorDocumentOwnerBlockIds: readonly string[];
  readonly isActiveSurface: boolean;
  readonly openCard?: (input: {
    projectId: string;
    cardId: string;
    titleSnapshot?: string;
  }) => void | Promise<void>;
}

export const appendInlineCardAncestor = (
  ancestors: readonly string[],
  cardId: string | null | undefined,
): readonly string[] => {
  if (!cardId || ancestors.includes(cardId)) return ancestors;
  return [...ancestors, cardId];
};

export const appendInlineDocumentOwnerAncestor = (
  ancestors: readonly string[],
  ownerBlockId: string | null | undefined,
): readonly string[] => {
  if (!ownerBlockId || ancestors.includes(ownerBlockId)) return ancestors;
  return [...ancestors, ownerBlockId];
};

export const isInlineCardCycle = (
  ancestors: readonly string[],
  targetCardId: string,
): boolean => ancestors.includes(targetCardId);

export const isInlineDocumentOwnerCycle = (
  ancestors: readonly string[],
  targetOwnerBlockId: string,
): boolean => ancestors.includes(targetOwnerBlockId);

const BlockReferenceRuntimeContext =
  createContext<BlockReferenceHostRuntime | null>(null);

export function BlockReferenceRuntimeProvider({
  value,
  children,
}: {
  readonly value: BlockReferenceHostRuntime;
  readonly children: ReactNode;
}) {
  return (
    <BlockReferenceRuntimeContext.Provider value={value}>
      {children}
    </BlockReferenceRuntimeContext.Provider>
  );
}

export const useBlockReferenceHostRuntime =
  (): BlockReferenceHostRuntime | null =>
    useContext(BlockReferenceRuntimeContext);
