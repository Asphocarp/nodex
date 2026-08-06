import type {
  DatabaseApplyOperationV2,
  DatabasePropertySetDeltaV2,
  DatabasePropertyValueInputV2,
  DatabasePropertyValueMutationV2,
  DatabaseModuleErrorCodeV2,
} from "../../shared/database-module-v2";
import type {
  DatabaseJsonValue,
  DatabasePropertyValueType,
} from "../../shared/database-kernel";
import {
  blockRecordSnapshotToWindow,
  buildBatchBlockRecordApplyInput,
  buildSetDataSourceValuesBlockRecordApplyInput,
  type BlockRecord,
  type BlockRecordWindow,
} from "../../shared/block-records";
import type { BlockRecordCommittedValue, CoreClientPort } from "./types";

type EditPropertyValuesOperation = Extract<
  DatabaseApplyOperationV2,
  { readonly kind: "edit_property_values" }
>;

interface ValueEntry {
  readonly propertyId: string;
  readonly value: DatabaseJsonValue;
  readonly revision: number;
}

interface PageValueState {
  readonly dataSourceId: string;
  readonly page: BlockRecord;
  readonly values: Map<string, ValueEntry>;
}

export interface CanonicalDatabaseValuesApplyInput {
  readonly client: CoreClientPort;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly operationId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly operations: readonly EditPropertyValuesOperation[];
  /** Data Source schema observed in the same authority boundary as the apply. */
  readonly propertyDefinitions: ReadonlyMap<
    string,
    ReadonlyMap<string, DatabasePropertyValueType>
  >;
}

export interface CanonicalDatabaseValuesApplyResult {
  readonly committed: BlockRecordCommittedValue;
  readonly dataSourceIds: readonly string[];
  readonly pageIds: readonly string[];
}

export class CanonicalDatabaseValueMutationError extends Error {
  constructor(
    readonly code: DatabaseModuleErrorCodeV2,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "CanonicalDatabaseValueMutationError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const requireIdentity = (value: string, label: string): void => {
  if (!value || value.trim() !== value) {
    throw new CanonicalDatabaseValueMutationError(
      "invalid_request",
      `${label} is invalid`,
    );
  }
};

const requireRevision = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CanonicalDatabaseValueMutationError(
      "invalid_request",
      `${label} is invalid`,
    );
  }
};

const readValueEntries = (page: BlockRecord): Map<string, ValueEntry> => {
  const raw = page.properties.dataSourceValues;
  if (raw === undefined) return new Map();
  if (!Array.isArray(raw)) {
    throw new CanonicalDatabaseValueMutationError(
      "state_corrupt",
      `Page ${page.id} has an invalid canonical Data Source value collection`,
    );
  }
  const values = new Map<string, ValueEntry>();
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.propertyId !== "string" || !("value" in entry)) {
      throw new CanonicalDatabaseValueMutationError(
        "state_corrupt",
        `Page ${page.id} has an invalid canonical Data Source value entry`,
      );
    }
    const revision = entry.revision === undefined ? 0 : entry.revision;
    requireRevision(revision as number, `Data Source value ${entry.propertyId} revision`);
    if (values.has(entry.propertyId)) {
      throw new CanonicalDatabaseValueMutationError(
        "state_corrupt",
        `Page ${page.id} has duplicate Data Source value ${entry.propertyId}`,
      );
    }
    values.set(entry.propertyId, {
      propertyId: entry.propertyId,
      value: entry.value as DatabaseJsonValue,
      revision: revision as number,
    });
  }
  return values;
};

const valueInputToJson = (input: DatabasePropertyValueInputV2): DatabaseJsonValue => {
  switch (input.kind) {
    case "empty":
      return null;
    case "text":
    case "number":
    case "checkbox":
    case "date":
    case "datetime":
      return input.value;
    case "select":
      return input.optionId;
    case "multi_select":
      return [...new Set(input.optionIds)].sort((left, right) => left.localeCompare(right));
    case "person":
      return input.personId;
    case "relation":
      return [...new Set(input.pageIds)].sort((left, right) => left.localeCompare(right));
  }
};

const stringSet = (
  value: DatabaseJsonValue | undefined,
  label: string,
): readonly string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new CanonicalDatabaseValueMutationError(
      "invalid_request",
      `${label} must be a string set`,
    );
  }
  return value;
};

const patchSet = (
  current: DatabaseJsonValue | undefined,
  delta: DatabasePropertySetDeltaV2,
  label: string,
): DatabaseJsonValue => {
  const currentValues = stringSet(current, label);
  const remove = new Set(
    delta.kind === "multi_select" ? delta.removeOptionIds : delta.removePageIds,
  );
  const add = delta.kind === "multi_select" ? delta.addOptionIds : delta.addPageIds;
  return [...new Set([
    ...currentValues.filter((value) => !remove.has(value)),
    ...add,
  ])].sort((left, right) => left.localeCompare(right));
};

const applyEdit = (
  values: Map<string, ValueEntry>,
  edit: DatabasePropertyValueMutationV2,
  propertyDefinitions?: ReadonlyMap<string, DatabasePropertyValueType>,
): void => {
  const definition = propertyDefinitions?.get(edit.propertyId);
  if (propertyDefinitions && !definition) {
    throw new CanonicalDatabaseValueMutationError(
      "resource_not_found",
      `Data Source Property ${edit.propertyId} is not active`,
    );
  }
  if (definition && edit.edit.kind === "replace" && edit.edit.value.kind !== "empty") {
    const expectedKind = definition;
    if (edit.edit.value.kind !== expectedKind) {
      throw new CanonicalDatabaseValueMutationError(
        "invalid_request",
        `Data Source Property ${edit.propertyId} expects ${expectedKind} values`,
      );
    }
  }
  if (definition && edit.edit.kind === "patch_set") {
    const expectedKind = definition === "multi_select" || definition === "relation"
      ? definition
      : null;
    if (expectedKind === null || edit.edit.delta.kind !== expectedKind) {
      throw new CanonicalDatabaseValueMutationError(
        "invalid_request",
        `Data Source Property ${edit.propertyId} does not support this set patch`,
      );
    }
  }
  const current = values.get(edit.propertyId);
  const currentRevision = current?.revision ?? 0;
  let nextValue: DatabaseJsonValue;
  if (edit.edit.kind === "replace") {
    requireRevision(edit.edit.expectedValueRevision, "expectedValueRevision");
    if (edit.edit.expectedValueRevision !== currentRevision) {
      throw new CanonicalDatabaseValueMutationError(
        "revision_conflict",
        `Data Source value ${edit.propertyId} revision changed`,
        true,
      );
    }
    nextValue = valueInputToJson(edit.edit.value);
  } else {
    nextValue = patchSet(
      current?.value,
      edit.edit.delta,
      `Data Source value ${edit.propertyId}`,
    );
  }
  const revision = currentRevision + 1;
  requireRevision(revision, "nextValueRevision");
  values.set(edit.propertyId, {
    propertyId: edit.propertyId,
    value: nextValue,
    revision,
  });
};

const readCanonicalWindows = async (
  input: CanonicalDatabaseValuesApplyInput,
  dataSourceIds: readonly string[],
): Promise<ReadonlyMap<string, BlockRecordWindow>> => {
  const windows = await Promise.all(dataSourceIds.map(async (dataSourceId) => {
    const read = {
      kind: "window" as const,
      parent: { kind: "data_source" as const, id: dataSourceId },
      include_content: false,
      include_descendants: false,
      include_archived: false,
    };
    const snapshot = await input.client.blockRecordRead(read);
    if (
      snapshot.library_id !== input.libraryId
      || snapshot.observed_cursor.store_epoch !== input.storeEpoch
    ) {
      throw new CanonicalDatabaseValueMutationError(
        "store_not_initialized",
        "Canonical Data Source value read crossed its Store epoch boundary",
        true,
      );
    }
    return [dataSourceId, blockRecordSnapshotToWindow(snapshot, read)] as const;
  }));
  return new Map(windows);
};

const findPage = (
  window: BlockRecordWindow,
  dataSourceId: string,
  pageId: string,
): BlockRecord => {
  const page = window.records.find((record) => record.id === pageId);
  if (!page || page.kind !== "page" || page.lifecycle !== "active") {
    throw new CanonicalDatabaseValueMutationError(
      "resource_not_found",
      `Page ${pageId} is not an active canonical Data Source row`,
    );
  }
  const placement = window.placements.find((candidate) => candidate.blockId === pageId);
  if (
    !placement
    || placement.parent.kind !== "dataSource"
    || placement.parent.dataSourceId !== dataSourceId
  ) {
    throw new CanonicalDatabaseValueMutationError(
      "revision_conflict",
      `Page ${pageId} is no longer placed in Data Source ${dataSourceId}`,
      true,
    );
  }
  return page;
};

export const applyCanonicalDatabaseValues = async (
  input: CanonicalDatabaseValuesApplyInput,
): Promise<CanonicalDatabaseValuesApplyResult> => {
  if (input.operations.length === 0) {
    throw new CanonicalDatabaseValueMutationError(
      "invalid_request",
      "Canonical Data Source value mutation is empty",
    );
  }
  requireIdentity(input.operationId, "operationId");
  requireIdentity(input.libraryId, "libraryId");
  requireIdentity(input.storeEpoch, "storeEpoch");
  requireIdentity(input.actorId, "actorId");
  requireIdentity(input.sessionId, "sessionId");

  const dataSourceIds = [...new Set(input.operations.flatMap((operation) => (
    operation.edits.map((edit) => edit.dataSourceId)
  )))].sort((left, right) => left.localeCompare(right));
  dataSourceIds.forEach((dataSourceId) => requireIdentity(dataSourceId, "dataSourceId"));
  const windows = await readCanonicalWindows(input, dataSourceIds);
  const pageStates = new Map<string, PageValueState>();
  const addresses = new Set<string>();
  for (const operation of input.operations) {
    for (const edit of operation.edits) {
      const address = `${edit.dataSourceId}\u0000${edit.pageId}\u0000${edit.propertyId}`;
      if (!addresses.add(address)) {
        throw new CanonicalDatabaseValueMutationError(
          "invalid_request",
          `Duplicate Data Source value address ${edit.pageId}/${edit.propertyId}`,
        );
      }
      const window = windows.get(edit.dataSourceId);
      if (!window) {
        throw new CanonicalDatabaseValueMutationError(
          "state_corrupt",
          `Canonical Data Source ${edit.dataSourceId} window is missing`,
        );
      }
      const stateKey = `${edit.dataSourceId}\u0000${edit.pageId}`;
      let state = pageStates.get(stateKey);
      if (!state) {
        const page = findPage(window, edit.dataSourceId, edit.pageId);
        state = {
          dataSourceId: edit.dataSourceId,
          page,
          values: readValueEntries(page),
        };
        pageStates.set(stateKey, state);
      }
      applyEdit(
        state.values,
        edit,
        input.propertyDefinitions.get(edit.dataSourceId),
      );
    }
  }

  const operations = await Promise.all(
    [...pageStates.values()]
      .sort((left, right) => left.page.id.localeCompare(right.page.id))
      .map(async (state) => {
        const request = await buildSetDataSourceValuesBlockRecordApplyInput({
          operationId: `${input.operationId}:page:${state.page.id}`,
          actorId: input.actorId,
          sessionId: input.sessionId,
          blockId: state.page.id,
          dataSourceId: state.dataSourceId,
          expectedBlockRevision: state.page.revision,
          values: [...state.values.values()]
            .sort((left, right) => left.propertyId.localeCompare(right.propertyId)),
        });
        if (request.operation.kind === "batch") {
          throw new Error("Canonical Data Source value operation unexpectedly nested a batch");
        }
        return request.operation;
      })
  );
  const batch = await buildBatchBlockRecordApplyInput({
    operationId: input.operationId,
    actorId: input.actorId,
    sessionId: input.sessionId,
    operations,
  });
  const committed = await input.client.blockRecordApply(batch);
  if (
    committed.operation_id !== input.operationId
    || committed.cursor.store_epoch !== input.storeEpoch
  ) {
    throw new CanonicalDatabaseValueMutationError(
      "state_corrupt",
      "Canonical Data Source value receipt crossed its operation boundary",
    );
  }
  return {
    committed,
    dataSourceIds,
    pageIds: [...pageStates.values()]
      .map((state) => state.page.id)
      .sort((left, right) => left.localeCompare(right)),
  };
};
