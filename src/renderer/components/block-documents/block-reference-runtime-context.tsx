import { createContext, useContext, type ReactNode } from "react";

export interface BlockReferenceHostRuntime {
  readonly projectId: string;
  readonly projectName: string | null;
  readonly projectWorkspacePath: string | null;
  readonly hostPageId: string | null;
  /**
   * Page Documents already open in this inline expansion chain, including
   * `hostPageId`. A reference may still open a matching Page in the Stage, but
   * must never mount its Document recursively inside this chain.
   */
  readonly ancestorPageIds: readonly string[];
  /**
   * Every independently synchronized owner already open in this inline
   * expansion chain. Unlike `ancestorPageIds`, this also includes Synced and
   * Template owners so reference cycles cannot recursively mount providers.
   */
  readonly ancestorDocumentOwnerBlockIds: readonly string[];
  readonly isActiveSurface: boolean;
  readonly openPage?: (input: {
    projectId: string;
    pageId: string;
    titleSnapshot?: string;
  }) => void | Promise<void>;
}

export const appendInlineCardAncestor = (
  ancestors: readonly string[],
  pageId: string | null | undefined,
): readonly string[] => {
  if (!pageId || ancestors.includes(pageId)) return ancestors;
  return [...ancestors, pageId];
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
  targetPageId: string,
): boolean => ancestors.includes(targetPageId);

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
