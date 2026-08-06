import { randomUUID } from "node:crypto";

import {
  connectOrStartCore,
  type ConnectOrStartCoreInput,
  type CoreLaunchResult,
} from "./core-launcher";
import {
  DesktopCoreAuthoritySupervisor,
  type CoreAuthorityIdentity,
  type CoreAuthorityState,
  type DesktopCoreAuthoritySupervisorDependencies,
  type DesktopCoreClient,
} from "./desktop-core-authority-supervisor";
import {
  LocalCommitDispatcher,
} from "./local-commit-dispatcher";
import { blockRecordCommitToLocalCommit } from "./block-record-local-commit";
import { getLogger } from "../logging/logger";
import type {
  BlockRecordCommittedValue,
  CoreEventSubscription,
} from "./types";

export interface RustDataAuthorityRuntime {
  readonly backend: "rust";
  readonly identity: CoreAuthorityIdentity;
  readonly launch: CoreLaunchResult;
  readonly rootClient: DesktopCoreClient;
  readonly localCommitDispatcher: LocalCommitDispatcher;
  clientForProject(projectId: string): DesktopCoreClient;
  close(): void;
  retryCoreNow(): Promise<void>;
  subscribeToCoreAuthority(
    listener: (state: CoreAuthorityState) => void,
  ): () => void;
}

export type DesktopDataAuthorityRuntime = RustDataAuthorityRuntime;

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const logger = getLogger({ component: "desktop-data-authority" });

function startLocalCommitTailer(
  client: DesktopCoreClient,
  dispatcher: LocalCommitDispatcher,
): { close: () => void } {
  let closed = false;
  let after = 0;
  let active: CoreEventSubscription | undefined;
  const run = async (): Promise<void> => {
    while (!closed) {
      try {
        active = await client.openLocalCommitStream(
          after,
          (commit: BlockRecordCommittedValue) => {
            try {
              const envelope = blockRecordCommitToLocalCommit(commit);
              dispatcher.accept(envelope, "tailer");
              after = Math.max(after, envelope.cursor.commitSeq);
            } catch (error) {
              logger.error("LocalCommit tailer admission failed", { error });
            }
          },
        );
        await active.done;
      } catch (error) {
        if (!closed) {
          logger.warn("LocalCommit tailer interrupted", { error });
        }
      } finally {
        active = undefined;
      }
      if (!closed) await delay(50);
    }
  };
  void run();
  return {
    close: () => {
      if (closed) return;
      closed = true;
      active?.close();
    },
  };
}

export interface InitializeDesktopDataAuthorityInput
  extends Omit<ConnectOrStartCoreInput, "nodexHome"> {
  readonly nodexHome: string;
  readonly supervisorDependencies?: DesktopCoreAuthoritySupervisorDependencies;
}

export async function initializeDesktopDataAuthority(
  input: InitializeDesktopDataAuthorityInput,
): Promise<RustDataAuthorityRuntime> {
  const { supervisorDependencies, ...launcherInput } = input;
  const localCommitDispatcher = new LocalCommitDispatcher({
    onListenerError: (error, envelope) => {
      logger.error("LocalCommit listener failed", {
        commitId: envelope.commitId,
        error,
      });
    },
  });
  const launchInput = {
    ...launcherInput,
    connectionId: launcherInput.connectionId ?? randomUUID(),
    onBlockRecordCommit: (commit: Parameters<typeof blockRecordCommitToLocalCommit>[0]) => {
      try {
        localCommitDispatcher.accept(
          blockRecordCommitToLocalCommit(commit),
          "apply",
        );
      } catch (error) {
        logger.error("LocalCommit apply response admission failed", { error });
      }
    },
  };
  const launch = await connectOrStartCore(launchInput);
  const health = await launch.client.health();
  if (health.status !== "ready") {
    throw new Error(`Native Rust Core reported unexpected status ${health.status}`);
  }
  localCommitDispatcher.resetForStoreEpoch({
    storeEpoch: launch.client.handshake.store_epoch,
    commitSeq: 0,
  });

  const supervisor = new DesktopCoreAuthoritySupervisor({
    initialLaunch: launch,
    launchInput,
    dependencies: supervisorDependencies,
  });
  const localCommitTailer = startLocalCommitTailer(
    supervisor.rootClient,
    localCommitDispatcher,
  );
  return {
    backend: "rust",
    identity: supervisor.identity,
    launch,
    rootClient: supervisor.rootClient,
    localCommitDispatcher,
    clientForProject: (projectId) => supervisor.clientForProject(projectId),
    close: () => {
      localCommitTailer.close();
      supervisor.close();
    },
    retryCoreNow: () => supervisor.retryNow(),
    subscribeToCoreAuthority: (listener) => supervisor.subscribe(listener),
  };
}
