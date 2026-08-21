import { createContext, useContext, type ReactNode } from "react";
import type { NfmMoveToDestination } from "./nfm-move-to-menu-model";

export interface NfmSideMenuRuntimeSnapshot {
  canSendBlocks: boolean;
  hasConvertDividerToThreadSection: boolean;
  sourceProjectId: string | null;
  sourcePageId: string | null;
  onMoveBlocksToDestination: (
    destination: NfmMoveToDestination,
    fallbackBlockId: string,
  ) => Promise<void> | void;
  onConvertDividerToThreadSection: (blockId: string) => void;
  onBlockDragStart: (input: {
    readonly dataTransfer: DataTransfer;
    readonly blockIds: readonly string[];
  }) => void;
  onBlockDragEnd: () => void;
  onDuplicateCanvas: (canvasBlockId: string) => Promise<void> | void;
  onDeleteCanvas: (canvasBlockId: string) => Promise<void> | void;
  onDeletePage: (pageBlockId: string) => Promise<void> | void;
}

export interface NfmSideMenuRuntimeValue {
  getSnapshot: () => NfmSideMenuRuntimeSnapshot;
}

const DEFAULT_SIDE_MENU_RUNTIME: NfmSideMenuRuntimeValue = {
  getSnapshot: () => ({
    canSendBlocks: false,
    hasConvertDividerToThreadSection: false,
    sourceProjectId: null,
    sourcePageId: null,
    onMoveBlocksToDestination: () => undefined,
    onConvertDividerToThreadSection: () => undefined,
    onBlockDragStart: () => undefined,
    onBlockDragEnd: () => undefined,
    onDuplicateCanvas: () => undefined,
    onDeleteCanvas: () => undefined,
    onDeletePage: () => undefined,
  }),
};

const NfmSideMenuRuntimeContext = createContext<NfmSideMenuRuntimeValue>(DEFAULT_SIDE_MENU_RUNTIME);

export function NfmSideMenuRuntimeProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: NfmSideMenuRuntimeValue;
}) {
  return (
    <NfmSideMenuRuntimeContext.Provider value={value}>
      {children}
    </NfmSideMenuRuntimeContext.Provider>
  );
}

export function useNfmSideMenuRuntime() {
  return useContext(NfmSideMenuRuntimeContext);
}
