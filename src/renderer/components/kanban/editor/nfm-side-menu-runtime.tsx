import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { NfmMoveToDestination } from "./nfm-move-to-menu-model";
import type { SendBlocksMode } from "./nfm-side-menu-model";

export interface NfmSideMenuRuntimeSnapshot {
  canSendBlocks: boolean;
  hasConvertDividerToThreadSection: boolean;
  sourceProjectId: string | null;
  sourceCardId: string | null;
  onSendBlocks: (mode: SendBlocksMode, fallbackBlockId: string) => void;
  onMoveBlocksToDestination: (
    destination: NfmMoveToDestination,
    fallbackBlockId: string,
  ) => Promise<void> | void;
  onConvertDividerToThreadSection: (blockId: string) => void;
}

export interface NfmSideMenuRuntimeValue {
  getSnapshot: () => NfmSideMenuRuntimeSnapshot;
}

const DEFAULT_SIDE_MENU_RUNTIME: NfmSideMenuRuntimeValue = {
  getSnapshot: () => ({
    canSendBlocks: false,
    hasConvertDividerToThreadSection: false,
    sourceProjectId: null,
    sourceCardId: null,
    onSendBlocks: () => undefined,
    onMoveBlocksToDestination: () => undefined,
    onConvertDividerToThreadSection: () => undefined,
  }),
};

const NfmSideMenuRuntimeContext = createContext<NfmSideMenuRuntimeValue>(
  DEFAULT_SIDE_MENU_RUNTIME,
);

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
