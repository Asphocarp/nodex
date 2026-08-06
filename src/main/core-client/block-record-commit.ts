import { CoreModuleResponseError } from "./core-client";
import type {
  BlockRecordApplyInput,
  BlockRecordCommittedValue,
  CoreClientPort,
} from "./types";

export interface ApplyBlockRecordWithResolutionInput {
  readonly client: CoreClientPort;
  readonly input: BlockRecordApplyInput;
  readonly storeEpoch: string;
}

/**
 * Resolves only transport/response-loss failures. A Core error is already a
 * definitive pre-commit result and must not be hidden behind another read.
 * The original operation identity is the only safe retry coordinate.
 */
export const applyBlockRecordWithResolution = async (
  input: ApplyBlockRecordWithResolutionInput,
): Promise<BlockRecordCommittedValue> => {
  try {
    return await input.client.blockRecordApply(input.input);
  } catch (error) {
    if (error instanceof CoreModuleResponseError) throw error;
    try {
      const resolved = await input.client.resolveLocalMutation({
        store_epoch: input.storeEpoch,
        operation_id: input.input.operation_id,
        intent_hash: input.input.intent_hash,
      });
      if (resolved) return resolved;
    } catch {
      // Preserve the original response-loss error. The caller can retry the
      // same operation ID again, while a resolver outage must not invent a
      // second mutation or convert a transport error into success.
    }
    throw error;
  }
};
