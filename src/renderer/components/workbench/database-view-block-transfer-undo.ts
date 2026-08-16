import type { BlockTransferUndoToken } from "../../../shared/block-transfer";
import { BLOCK_TRANSFER_CONTRACT_VERSION } from "../../../shared/block-transfer";
import { undoBlockTransfer } from "@/lib/api";
import { toast } from "@/components/ui/toast";

export async function undoDatabaseViewBlockTransfer(input: {
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly token: BlockTransferUndoToken;
  readonly onCommitted?: () => void | Promise<void>;
}): Promise<boolean> {
  const result = await undoBlockTransfer(input.projectId, {
    version: BLOCK_TRANSFER_CONTRACT_VERSION,
    operationId: crypto.randomUUID(),
    projectId: input.projectId,
    storeEpoch: input.storeEpoch,
    token: input.token,
  });
  if (!result.ok) {
    toast.warning(
      result.error.code === "undo_conflict"
        ? "This promotion can’t be undone because its Page or source changed afterward."
        : result.error.message,
    );
    return false;
  }
  await input.onCommitted?.();
  toast.info("Block promotion undone.");
  return true;
}
