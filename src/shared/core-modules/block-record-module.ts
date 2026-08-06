import type { components } from "@nodex/core-protocol";

/**
 * BlockRecord is a library-scoped Core module.  Keep its wire shapes sourced
 * from the generated protocol; renderer code should consume these aliases
 * through the typed IPC boundary instead of importing Main-process types.
 */
export type BlockRecordRead = components["schemas"]["BlockRecordRead"];
export type BlockRecordReadSnapshot = components["schemas"]["BlockRecordReadSnapshot"];
export type BlockRecordApplyInput = Omit<
  components["schemas"]["BlockRecordApplyRequest"],
  "contract_version" | "store_epoch"
>;
export type BlockRecordCommittedValue = components["schemas"]["BlockRecordCommittedValue"];

export interface BlockRecordModule {
  read(read: BlockRecordRead): Promise<BlockRecordReadSnapshot>;
  apply(input: BlockRecordApplyInput): Promise<BlockRecordCommittedValue>;
}
