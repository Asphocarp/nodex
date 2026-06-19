import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { SendBlocksMode } from "./nfm-side-menu-model";

export interface NfmSideMenuRuntimeSnapshot {
  canSendBlocks: boolean;
  hasConvertDividerToThreadSection: boolean;
  onSendBlocks: (mode: SendBlocksMode, fallbackBlockId: string) => void;
  onConvertDividerToThreadSection: (blockId: string) => void;
}

export interface NfmSideMenuRuntimeValue {
  getSnapshot: () => NfmSideMenuRuntimeSnapshot;
}

const DEFAULT_SIDE_MENU_RUNTIME: NfmSideMenuRuntimeValue = {
  getSnapshot: () => ({
    canSendBlocks: false,
    hasConvertDividerToThreadSection: false,
    onSendBlocks: () => undefined,
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
