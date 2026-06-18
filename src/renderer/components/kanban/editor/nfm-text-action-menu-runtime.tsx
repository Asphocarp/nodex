import { createContext, useContext, type ReactNode } from "react";
import type { SendBlocksMode } from "./nfm-drag-handle-menu";

export interface NfmTextActionMenuRuntimeValue {
  canSendBlocks: boolean;
  onSendBlocks?: (mode: SendBlocksMode, fallbackBlockId: string) => void;
  onSendThreadSection?: (blockId: string) => boolean;
  onConvertDividerToThreadSection?: (blockId: string) => void;
}

const DEFAULT_TEXT_ACTION_MENU_RUNTIME: NfmTextActionMenuRuntimeValue = {
  canSendBlocks: false,
};

const NfmTextActionMenuRuntimeContext =
  createContext<NfmTextActionMenuRuntimeValue>(DEFAULT_TEXT_ACTION_MENU_RUNTIME);

export function NfmTextActionMenuRuntimeProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: NfmTextActionMenuRuntimeValue;
}) {
  return (
    <NfmTextActionMenuRuntimeContext.Provider value={value}>
      {children}
    </NfmTextActionMenuRuntimeContext.Provider>
  );
}

export function useNfmTextActionMenuRuntime() {
  return useContext(NfmTextActionMenuRuntimeContext);
}
