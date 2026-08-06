import type { IpcApi, IpcEvents } from "../shared/ipc-api";
import type { LocalCommitEnvelope } from "../shared/local-commit";
import type { BlockRecordModule } from "../shared/core-modules/block-record-module";
import type { LocalCommitDispatcher } from "./core-client/local-commit-dispatcher";

export const BLOCK_RECORD_READ_IPC_CHANNEL = "block-record:read" as const;
export const BLOCK_RECORD_APPLY_IPC_CHANNEL = "block-record:apply" as const;
export const BLOCK_RECORD_SUBSCRIBE_IPC_CHANNEL = "block-record:subscribe" as const;
export const BLOCK_RECORD_UNSUBSCRIBE_IPC_CHANNEL = "block-record:unsubscribe" as const;

type BlockRecordIpcChannel =
  | typeof BLOCK_RECORD_READ_IPC_CHANNEL
  | typeof BLOCK_RECORD_APPLY_IPC_CHANNEL
  | typeof BLOCK_RECORD_SUBSCRIBE_IPC_CHANNEL
  | typeof BLOCK_RECORD_UNSUBSCRIBE_IPC_CHANNEL;

export interface BlockRecordIpcDependencies {
  readonly registerHandle: (
    channel: BlockRecordIpcChannel,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ) => void;
  readonly isTrustedEvent: (event: unknown) => boolean;
  readonly module: BlockRecordModule;
  readonly dispatcher: LocalCommitDispatcher | Promise<LocalCommitDispatcher>;
  readonly getSenderId: (event: unknown) => number;
  readonly sendCommit: (
    event: unknown,
    envelope: LocalCommitEnvelope,
  ) => void;
  readonly onSenderDestroyed: (event: unknown, cleanup: () => void) => void;
}

const requireTrusted = (
  dependencies: BlockRecordIpcDependencies,
  event: unknown,
): void => {
  if (dependencies.isTrustedEvent(event)) return;
  throw new Error("BlockRecord IPC is restricted to a trusted application window");
};

export const registerBlockRecordIpcHandler = (
  dependencies: BlockRecordIpcDependencies,
): void => {
  const subscriptions = new Map<number, () => void>();
  const unsubscribe = (senderId: number): void => {
    subscriptions.get(senderId)?.();
    subscriptions.delete(senderId);
  };

  dependencies.registerHandle(
    BLOCK_RECORD_READ_IPC_CHANNEL,
    async (event, ...args) => {
      requireTrusted(dependencies, event);
      const [read] = args as IpcApi["block-record:read"]["args"];
      return await dependencies.module.read(read);
    },
  );
  dependencies.registerHandle(
    BLOCK_RECORD_APPLY_IPC_CHANNEL,
    async (event, ...args) => {
      requireTrusted(dependencies, event);
      const [input] = args as IpcApi["block-record:apply"]["args"];
      return await dependencies.module.apply(input);
    },
  );
  dependencies.registerHandle(
    BLOCK_RECORD_SUBSCRIBE_IPC_CHANNEL,
    async (event) => {
      requireTrusted(dependencies, event);
      const senderId = dependencies.getSenderId(event);
      unsubscribe(senderId);
      const dispatcher = await dependencies.dispatcher;
      const remove = dispatcher.subscribe((envelope) => {
        dependencies.sendCommit(event, envelope);
      });
      subscriptions.set(senderId, remove);
      dependencies.onSenderDestroyed(event, () => unsubscribe(senderId));
    },
  );
  dependencies.registerHandle(
    BLOCK_RECORD_UNSUBSCRIBE_IPC_CHANNEL,
    (event) => {
      requireTrusted(dependencies, event);
      unsubscribe(dependencies.getSenderId(event));
    },
  );
};

export type BlockRecordCommitEvent = IpcEvents["block-record:commit"];
