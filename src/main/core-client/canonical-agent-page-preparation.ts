import { createHash } from "node:crypto";
import type { components } from "@nodex/core-protocol";
import type {
  BlockPlacement,
  BlockPlacementParent,
  BlockRecord,
  BlockRecordWindow,
} from "../../shared/block-records";
import type { BlockRecordRead } from "../../shared/core-modules/block-record-module";
import { blockRecordSnapshotToWindow } from "../../shared/block-records";
import type { CoreClientPort } from "./types";
import type {
  AgentPageDestination,
  AgentSiblingAnchor,
} from "./native-nodex-agent-page-destination";
import type { NodexAgentCanonicalPageDestination } from "../../shared/nodex-agent-tools/v3-write-runtime";

type AgentAuthorization = components["schemas"]["AgentExecutionAuthorization"];

export interface CanonicalAgentDestinationPreparation {
  readonly destination: NodexAgentCanonicalPageDestination;
  readonly parent: BlockPlacementParent;
  readonly window: BlockRecordWindow;
}

const assertSnapshot = (
  snapshot: Awaited<ReturnType<CoreClientPort["blockRecordRead"]>>,
  libraryId: string,
  storeEpoch: string,
): void => {
  if (
    snapshot.library_id !== libraryId
    || snapshot.observed_cursor.store_epoch !== storeEpoch
  ) {
    throw new Error("Canonical Agent preparation escaped its BlockRecord snapshot boundary");
  }
};

const readTarget = async (
  client: CoreClientPort,
  read: BlockRecordRead,
  authorization: AgentAuthorization,
  libraryId: string,
  storeEpoch: string,
): Promise<BlockRecordWindow> => {
  const snapshot = await client.blockRecordRead(read, authorization);
  assertSnapshot(snapshot, libraryId, storeEpoch);
  return blockRecordSnapshotToWindow(snapshot, read);
};

const sortedPlacements = (
  window: BlockRecordWindow,
  parent: BlockPlacementParent,
): readonly BlockPlacement[] => window.placements
  .filter((placement) => {
    if (parent.kind === "library") return placement.parent.kind === "library";
    if (parent.kind === "block") {
      return placement.parent.kind === "block"
        && placement.parent.blockId === parent.blockId;
    }
    return placement.parent.kind === "dataSource"
      && placement.parent.dataSourceId === parent.dataSourceId;
  })
  .sort((left, right) => (
    left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId)
  ));

const beforeId = (
  anchor: AgentSiblingAnchor | undefined,
  placements: readonly BlockPlacement[],
): string | undefined => {
  if (!anchor || anchor.kind === "end") return undefined;
  if (anchor.kind === "start") return placements[0]?.blockId;
  if (anchor.kind !== "before" && anchor.kind !== "after") return undefined;
  const index = placements.findIndex((placement) => placement.blockId === anchor.blockId);
  if (index < 0) throw new Error(`Canonical Agent anchor ${anchor.blockId} is unavailable`);
  if (anchor.kind === "before") return anchor.blockId;
  return placements[index + 1]?.blockId;
};

const viewBeforeId = (
  anchor: AgentSiblingAnchor | undefined,
  positions: readonly { readonly blockId: string; readonly rankKey: string }[],
): string | undefined => {
  if (!anchor || anchor.kind === "end") return undefined;
  if (anchor.kind === "start") return positions[0]?.blockId;
  if (anchor.kind !== "before" && anchor.kind !== "after") return undefined;
  const index = positions.findIndex((position) => position.blockId === anchor.blockId);
  if (index < 0) throw new Error(`Canonical Agent View anchor ${anchor.blockId} is unavailable`);
  if (anchor.kind === "before") return anchor.blockId;
  return positions[index + 1]?.blockId;
};

const targetRead = (
  destination: AgentPageDestination,
): { readonly parent: BlockPlacementParent; readonly read: BlockRecordRead } => {
  if (destination.kind === "library") {
    return {
      parent: { kind: "library", libraryId: "" },
      read: {
        kind: "window",
        parent: { kind: "library" },
        include_content: false,
        include_descendants: false,
      },
    };
  }
  if (destination.kind === "page") {
    return {
      parent: { kind: "block", blockId: destination.pageId },
      read: {
        kind: "window",
        parent: { kind: "block", id: destination.pageId },
        include_content: false,
        include_descendants: false,
      },
    };
  }
  return {
    parent: { kind: "dataSource", dataSourceId: destination.dataSourceId },
    read: {
      kind: "window",
      parent: { kind: "data_source", id: destination.dataSourceId },
      ...(destination.view ? { view_id: destination.view.viewId } : {}),
      include_content: false,
      include_descendants: false,
    },
  };
};

const requirePage = (
  window: BlockRecordWindow,
  pageId: string,
): BlockRecord => {
  const record = window.records.find((candidate) => candidate.id === pageId);
  if (!record || record.kind !== "page" || record.lifecycle !== "active") {
    throw new Error(`Canonical Agent destination Page ${pageId} is unavailable`);
  }
  return record;
};

export const prepareCanonicalAgentDestination = async (
  input: {
    readonly client: CoreClientPort;
    readonly destination: AgentPageDestination;
    readonly authorization: AgentAuthorization;
    readonly libraryId: string;
    readonly storeEpoch: string;
  },
): Promise<CanonicalAgentDestinationPreparation> => {
  const target = targetRead(input.destination);
  const parent = target.parent.kind === "library"
    ? { kind: "library" as const, libraryId: input.libraryId }
    : target.parent;
  const window = await readTarget(
    input.client,
    target.read,
    input.authorization,
    input.libraryId,
    input.storeEpoch,
  );
  if (input.destination.kind === "page") requirePage(window, input.destination.pageId);

  const placements = sortedPlacements(window, parent);
  if (input.destination.kind === "library") {
    const resolvedBefore = beforeId(input.destination.at, placements);
    return {
      parent,
      window,
      destination: {
        kind: "space",
        ...(resolvedBefore ? { beforeBlockId: resolvedBefore } : {}),
      },
    };
  }
  if (input.destination.kind === "page") {
    const resolvedBefore = beforeId(input.destination.at, placements);
    return {
      parent,
      window,
      destination: {
        kind: "document",
        pageId: input.destination.pageId,
        ...(resolvedBefore ? { beforeBlockId: resolvedBefore } : {}),
      },
    };
  }
  const dataSourceDestination = input.destination;
  if (dataSourceDestination.kind !== "data_source" || !dataSourceDestination.view) {
    throw new Error("Canonical Agent Data Source destination requires a View");
  }
  const viewPositions = window.viewPositions
    .filter((position) => (
      position.viewId === dataSourceDestination.view!.viewId
      && position.groupKey === (dataSourceDestination.view!.groupKey ?? null)
    ))
    .sort((left, right) => (
      left.rankKey.localeCompare(right.rankKey) || left.blockId.localeCompare(right.blockId)
    ));
  const resolvedBefore = viewBeforeId(
    dataSourceDestination.view.at,
    viewPositions,
  );
  return {
    parent,
    window,
    destination: {
      kind: "database",
      dataSourceId: dataSourceDestination.dataSourceId,
      view: {
        viewId: dataSourceDestination.view.viewId,
        groupKey: dataSourceDestination.view.groupKey ?? null,
        ...(resolvedBefore ? { beforePageId: resolvedBefore } : {}),
      },
    },
  };
};

export const readCanonicalAgentBlockRoots = async (
  input: {
    readonly client: CoreClientPort;
    readonly blockIds: readonly string[];
    readonly authorization: AgentAuthorization;
    readonly libraryId: string;
    readonly storeEpoch: string;
  },
): Promise<BlockRecordWindow> => readTarget(
  input.client,
  {
    kind: "window",
    block_ids: [...input.blockIds],
    include_content: true,
    include_descendants: true,
  },
  input.authorization,
  input.libraryId,
  input.storeEpoch,
);

export const canonicalAgentIdentity = (
  operationId: string,
  kind: "page" | "block",
  ordinal: string | number,
): string => `agent-${kind}:${createHash("sha256")
  .update(`${operationId}\0${kind}\0${ordinal}`)
  .digest("hex")}`;

export const canonicalAgentCommandFingerprint = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
