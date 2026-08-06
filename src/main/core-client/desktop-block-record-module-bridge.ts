import type {
  BlockRecordApplyInput,
  BlockRecordCommittedValue,
  BlockRecordModule,
  BlockRecordRead,
  BlockRecordReadSnapshot,
} from "../../shared/core-modules/block-record-module";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";

export type DesktopBlockRecordModuleBridge = BlockRecordModule;

export interface DesktopBlockRecordModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
}

export function createDesktopBlockRecordModuleBridge(
  input: DesktopBlockRecordModuleBridgeInput,
): DesktopBlockRecordModuleBridge {
  return {
    read: async (read: BlockRecordRead): Promise<BlockRecordReadSnapshot> => {
      const runtime = await input.authority;
      return await runtime.rootClient.blockRecordRead(read);
    },
    apply: async (
      apply: BlockRecordApplyInput,
    ): Promise<BlockRecordCommittedValue> => {
      const runtime = await input.authority;
      return await runtime.rootClient.blockRecordApply(apply);
    },
  };
}
