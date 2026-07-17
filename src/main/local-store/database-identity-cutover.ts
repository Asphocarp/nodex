import { createHash } from "node:crypto";
import {
  canonicalizeBlockPropertyMutationRequest,
  makeBlockPropertyFieldPath,
  parseBlockPropertyMutationRequest,
  parseBlockPropertyMutationResult,
  stableStringifyBlockPropertyJson,
  type BlockPropertyFieldMutation,
  type BlockPropertyMutationFieldResult,
} from "../../shared/block-property-mutations";
import {
  BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION,
  canonicalizeBlockPropertyMutationRequestV2,
  makeBlockPropertyFieldPathV2,
  parseBlockPropertyMutationRequestV2,
  parseBlockPropertyMutationResultV2,
  stableStringifyBlockPropertyJsonV2,
  type BlockPropertyFieldMutationV2,
  type BlockPropertyJsonValueV2,
  type BlockPropertyMutationFieldResultV2,
} from "../../shared/block-property-mutations-v2";
import {
  parsePageLifecycleMutationReceipt,
  parsePageLifecycleMutationRequest,
} from "../../shared/page-lifecycle";
import {
  databaseGroupKeyForValue,
  parseDatabasePropertyConfig,
  parseDatabaseViewConfig,
  parseDatabaseViewConfigV2,
  databaseGroupValueFromKey,
  type DatabasePropertyValueType,
  type DatabaseJsonValue,
  type DatabaseViewConfigV2,
  type DatabaseViewFilterNode,
} from "../../shared/database-kernel";
import {
  isReservedDataSourcePropertyId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
  type BuiltInDataSourcePropertyId,
  type DataSourceOptionId,
  type DataSourcePropertyId,
} from "../../shared/database-identities";
import {
  WORKFLOW_STATUS_CUTOVER_MAP,
  isLegacyWorkflowStatus,
} from "../../shared/workflow-status-cutover";

const PROPERTY_ID_DOMAIN = "nodex:v81:data-source-property";
const OPTION_ID_DOMAIN = "nodex:v81:data-source-option";

export interface PropertyIdentityCandidate {
  readonly dataSourceId: string;
  readonly oldPropertyId: string;
  readonly reservedPropertyId?: BuiltInDataSourcePropertyId;
}

export interface PropertyIdentityMapping {
  readonly dataSourceId: string;
  readonly oldPropertyId: string;
  readonly newPropertyId: DataSourcePropertyId;
  readonly collisionCounter: number | null;
}

export interface OptionIdentityCandidate {
  readonly dataSourceId: string;
  readonly oldPropertyId: string;
  readonly newPropertyId: DataSourcePropertyId;
  readonly oldOptionId: string;
}

export interface OptionIdentityMapping extends OptionIdentityCandidate {
  readonly newOptionId: DataSourceOptionId;
  readonly collisionCounter: number | null;
}

export interface BlockPropertyEvidenceAggregate {
  readonly mutationKind: string;
  readonly outcome: "committed" | "rejected" | string;
  readonly requestJson: string;
  readonly requestHash: string;
  readonly fieldIntentsJson: string;
  readonly expectedRevisionsJson: string;
  readonly resultJson: string;
  readonly committedRevisionsJson: string;
  readonly changePayloadJson: string | null;
}

export interface RewrittenBlockPropertyEvidenceAggregate {
  readonly requestJson: string;
  readonly requestHash: string;
  readonly fieldIntentsJson: string;
  readonly expectedRevisionsJson: string;
  readonly resultJson: string;
  readonly committedRevisionsJson: string;
  readonly changePayloadJson: string;
}

export type BlockPropertyEvidenceRewriteResult =
  | {
      readonly kind: "rewritten_committed";
      readonly evidence: RewrittenBlockPropertyEvidenceAggregate;
    }
  | {
      readonly kind: "retained_rejected";
      readonly reason: "rejected_evidence_is_literal";
    }
  | {
      readonly kind: "unknown_evidence";
      readonly reason: "not_property_batch" | "unknown_outcome";
    };

export interface DatabaseViewPositionGroupKeyRewriteInput {
  readonly dataSourceId: string;
  readonly oldPropertyId: string;
  readonly valueType: DatabasePropertyValueType;
  readonly groupKey: string | null;
  readonly propertyMappings: readonly PropertyIdentityMapping[];
  readonly optionMappings: readonly OptionIdentityMapping[];
}

export interface PageLifecycleCreateEvidenceAggregate {
  readonly mutationKind: string;
  readonly outcome: "committed" | "rejected" | string;
  readonly requestJson: string;
  readonly requestHash: string;
  readonly fieldIntentsJson: string;
  readonly resultJson: string;
  readonly changePayloadJson: string | null;
}

export interface RewrittenPageLifecycleCreateEvidenceAggregate {
  readonly requestJson: string;
  readonly requestHash: string;
  readonly fieldIntentsJson: string;
  readonly resultJson: string;
  readonly changePayloadJson: string;
}

export type PageLifecycleCreateEvidenceRewriteResult =
  | {
      readonly kind: "rewritten_committed_create";
      readonly evidence: RewrittenPageLifecycleCreateEvidenceAggregate;
    }
  | {
      readonly kind: "retained_rejected";
      readonly reason: "rejected_evidence_is_literal";
    }
  | {
      readonly kind: "unknown_evidence";
      readonly reason:
        | "not_page_lifecycle"
        | "not_create_page"
        | "unknown_outcome";
    };

export type DatabaseOperationEvidenceAggregate = BlockPropertyEvidenceAggregate;

export type RewrittenDatabaseOperationEvidenceAggregate =
  RewrittenBlockPropertyEvidenceAggregate;

export type DatabaseOperationEvidenceRewriteResult =
  | {
      readonly kind: "rewritten_committed_database_operation";
      readonly evidence: RewrittenDatabaseOperationEvidenceAggregate;
    }
  | {
      readonly kind: "retained_rejected";
      readonly reason: "rejected_evidence_is_literal";
    }
  | {
      readonly kind: "unknown_evidence";
      readonly reason: "not_database_operation" | "unknown_outcome";
    };

export class DatabaseIdentityCutoverError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseIdentityCutoverError";
  }
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const requireCanonicalIdentity = (value: string, label: string): string => {
  if (value.length > 0 && value.length <= 512 && value === value.trim()) {
    return value;
  }
  throw new DatabaseIdentityCutoverError(`${label} is not a canonical identity`);
};

const compactDigest = (
  prefix: "p_" | "o_",
  domain: string,
  coordinates: readonly (string | number)[],
): string => {
  const digest = createHash("sha256")
    .update(stableStringifyBlockPropertyJson([domain, ...coordinates]))
    .digest()
    .subarray(0, 6)
    .toString("base64url");
  return `${prefix}${digest}`;
};

export const deterministicPropertyIdCandidate = (input: {
  readonly dataSourceId: string;
  readonly oldPropertyId: string;
  readonly collisionCounter: number;
}): DataSourcePropertyId => {
  requireCanonicalIdentity(input.dataSourceId, "dataSourceId");
  requireCanonicalIdentity(input.oldPropertyId, "oldPropertyId");
  if (!Number.isSafeInteger(input.collisionCounter) || input.collisionCounter < 0) {
    throw new DatabaseIdentityCutoverError(
      "collisionCounter must be a non-negative safe integer",
    );
  }
  return parseDataSourcePropertyId(
    compactDigest("p_", PROPERTY_ID_DOMAIN, [
      input.dataSourceId,
      input.oldPropertyId,
      input.collisionCounter,
    ]),
  );
};

export const deterministicOptionIdCandidate = (input: {
  readonly dataSourceId: string;
  readonly newPropertyId: DataSourcePropertyId;
  readonly oldOptionId: string;
  readonly collisionCounter: number;
}): DataSourceOptionId => {
  requireCanonicalIdentity(input.dataSourceId, "dataSourceId");
  requireCanonicalIdentity(input.oldOptionId, "oldOptionId");
  if (!Number.isSafeInteger(input.collisionCounter) || input.collisionCounter < 0) {
    throw new DatabaseIdentityCutoverError(
      "collisionCounter must be a non-negative safe integer",
    );
  }
  const candidate = compactDigest("o_", OPTION_ID_DOMAIN, [
    input.dataSourceId,
    input.newPropertyId,
    input.oldOptionId,
    input.collisionCounter,
  ]);
  try {
    return parseDataSourceOptionId({
      propertyId: input.newPropertyId,
      value: candidate,
    });
  } catch {
    throw new DatabaseIdentityCutoverError(
      `Property ${input.newPropertyId} does not accept generated custom option IDs`,
    );
  }
};

export const allocateDeterministicPropertyIdentity = (input: {
  readonly dataSourceId: string;
  readonly oldPropertyId: string;
  readonly isTaken: (candidate: DataSourcePropertyId) => boolean;
}): Pick<PropertyIdentityMapping, "newPropertyId" | "collisionCounter"> => {
  let collisionCounter = 0;
  let newPropertyId = deterministicPropertyIdCandidate({
    ...input,
    collisionCounter,
  });
  while (input.isTaken(newPropertyId)) {
    collisionCounter += 1;
    newPropertyId = deterministicPropertyIdCandidate({
      ...input,
      collisionCounter,
    });
  }
  return { newPropertyId, collisionCounter };
};

export const allocateDeterministicOptionIdentity = (input: {
  readonly dataSourceId: string;
  readonly newPropertyId: DataSourcePropertyId;
  readonly oldOptionId: string;
  readonly isTaken: (candidate: DataSourceOptionId) => boolean;
}): Pick<OptionIdentityMapping, "newOptionId" | "collisionCounter"> => {
  let collisionCounter = 0;
  let newOptionId = deterministicOptionIdCandidate({
    ...input,
    collisionCounter,
  });
  while (input.isTaken(newOptionId)) {
    collisionCounter += 1;
    newOptionId = deterministicOptionIdCandidate({
      ...input,
      collisionCounter,
    });
  }
  return { newOptionId, collisionCounter };
};

const mappingKey = (...coordinates: readonly string[]): string =>
  stableStringifyBlockPropertyJson(coordinates);

export const createPropertyIdentityMappings = (
  candidates: readonly PropertyIdentityCandidate[],
): readonly PropertyIdentityMapping[] => {
  const mappings: PropertyIdentityMapping[] = [];
  const seenOld = new Set<string>();
  const takenBySource = new Map<string, Set<string>>();
  const ordered = [...candidates].sort((left, right) =>
    compareStrings(
      mappingKey(left.dataSourceId, left.oldPropertyId),
      mappingKey(right.dataSourceId, right.oldPropertyId),
    ),
  );
  for (const candidate of ordered) {
    const dataSourceId = requireCanonicalIdentity(
      candidate.dataSourceId,
      "dataSourceId",
    );
    const oldPropertyId = requireCanonicalIdentity(
      candidate.oldPropertyId,
      "oldPropertyId",
    );
    const oldKey = mappingKey(dataSourceId, oldPropertyId);
    if (seenOld.has(oldKey)) {
      throw new DatabaseIdentityCutoverError(
        `Duplicate Property mapping candidate ${oldPropertyId} in ${dataSourceId}`,
      );
    }
    seenOld.add(oldKey);
    const taken = takenBySource.get(dataSourceId) ?? new Set<string>();
    takenBySource.set(dataSourceId, taken);
    if (candidate.reservedPropertyId !== undefined) {
      if (!isReservedDataSourcePropertyId(candidate.reservedPropertyId)) {
        throw new DatabaseIdentityCutoverError(
          `${candidate.reservedPropertyId} is not a reserved Property ID`,
        );
      }
      if (taken.has(candidate.reservedPropertyId)) {
        throw new DatabaseIdentityCutoverError(
          `Property identity ${candidate.reservedPropertyId} collides in ${dataSourceId}`,
        );
      }
      taken.add(candidate.reservedPropertyId);
      mappings.push({
        dataSourceId,
        oldPropertyId,
        newPropertyId: parseDataSourcePropertyId(candidate.reservedPropertyId),
        collisionCounter: null,
      });
      continue;
    }
    const { newPropertyId, collisionCounter } =
      allocateDeterministicPropertyIdentity({
        dataSourceId,
        oldPropertyId,
        isTaken: (candidateId) => taken.has(candidateId),
      });
    taken.add(newPropertyId);
    mappings.push({
      dataSourceId,
      oldPropertyId,
      newPropertyId,
      collisionCounter,
    });
  }
  return mappings;
};

export const createOptionIdentityMappings = (
  candidates: readonly OptionIdentityCandidate[],
  options: Readonly<{ preserveLegacyWorkflowStatusIds?: boolean }> = {},
): readonly OptionIdentityMapping[] => {
  const seenOld = new Set<string>();
  const takenByProperty = new Map<string, Set<string>>();
  const ordered = [...candidates].sort((left, right) =>
    compareStrings(
      mappingKey(left.dataSourceId, left.newPropertyId, left.oldOptionId),
      mappingKey(right.dataSourceId, right.newPropertyId, right.oldOptionId),
    ),
  );
  const normalized = ordered.map((candidate) => {
    const dataSourceId = requireCanonicalIdentity(
      candidate.dataSourceId,
      "dataSourceId",
    );
    const oldPropertyId = requireCanonicalIdentity(
      candidate.oldPropertyId,
      "oldPropertyId",
    );
    const oldOptionId = requireCanonicalIdentity(
      candidate.oldOptionId,
      "oldOptionId",
    );
    const oldKey = mappingKey(dataSourceId, oldPropertyId, oldOptionId);
    if (seenOld.has(oldKey)) {
      throw new DatabaseIdentityCutoverError(
        `Duplicate option mapping candidate ${oldOptionId}`,
      );
    }
    seenOld.add(oldKey);
    return { ...candidate, dataSourceId, oldPropertyId, oldOptionId };
  });
  const preservedByOldKey = new Map<string, DataSourceOptionId>();
  for (const candidate of normalized) {
    const propertyKey = mappingKey(
      candidate.dataSourceId,
      candidate.newPropertyId,
    );
    const taken = takenByProperty.get(propertyKey) ?? new Set<string>();
    takenByProperty.set(propertyKey, taken);
    try {
      const preserved = options.preserveLegacyWorkflowStatusIds === true
        && candidate.newPropertyId === "status"
        && isLegacyWorkflowStatus(candidate.oldOptionId)
        ? candidate.oldOptionId as DataSourceOptionId
        : parseDataSourceOptionId({
            propertyId: candidate.newPropertyId,
            value: candidate.oldOptionId,
          });
      if (taken.has(preserved)) {
        throw new DatabaseIdentityCutoverError(
          `Option identity ${preserved} collides in Property ${candidate.newPropertyId}`,
        );
      }
      taken.add(preserved);
      preservedByOldKey.set(
        mappingKey(
          candidate.dataSourceId,
          candidate.oldPropertyId,
          candidate.oldOptionId,
        ),
        preserved,
      );
    } catch (error) {
      if (error instanceof DatabaseIdentityCutoverError) {
        throw error;
      }
    }
  }
  const mappings: OptionIdentityMapping[] = [];
  for (const candidate of normalized) {
    const oldKey = mappingKey(
      candidate.dataSourceId,
      candidate.oldPropertyId,
      candidate.oldOptionId,
    );
    const preserved = preservedByOldKey.get(oldKey);
    if (preserved) {
      mappings.push({
        ...candidate,
        newOptionId: preserved,
        collisionCounter: null,
      });
      continue;
    }
    const propertyKey = mappingKey(
      candidate.dataSourceId,
      candidate.newPropertyId,
    );
    const taken = takenByProperty.get(propertyKey) ?? new Set<string>();
    const { newOptionId, collisionCounter } =
      allocateDeterministicOptionIdentity({
        dataSourceId: candidate.dataSourceId,
        newPropertyId: candidate.newPropertyId,
        oldOptionId: candidate.oldOptionId,
        isTaken: (candidateId) => taken.has(candidateId),
      });
    taken.add(newOptionId);
    mappings.push({
      ...candidate,
      newOptionId,
      collisionCounter,
    });
  }
  return mappings;
};

interface MappingIndexes {
  readonly propertyByOldId: ReadonlyMap<string, PropertyIdentityMapping>;
  readonly optionByOldCoordinate: ReadonlyMap<string, OptionIdentityMapping>;
  readonly optionBearingProperties: ReadonlySet<string>;
  readonly unscopedOptionByOldId: ReadonlyMap<string, string>;
  readonly ambiguousUnscopedOptionIds: ReadonlySet<string>;
}

const createMappingIndexes = (
  propertyMappings: readonly PropertyIdentityMapping[],
  optionMappings: readonly OptionIdentityMapping[],
): MappingIndexes => {
  const propertyByOldId = new Map<string, PropertyIdentityMapping>();
  for (const mapping of propertyMappings) {
    const existing = propertyByOldId.get(mapping.oldPropertyId);
    if (existing && existing.dataSourceId !== mapping.dataSourceId) {
      throw new DatabaseIdentityCutoverError(
        `Old Property identity ${mapping.oldPropertyId} is ambiguous across Data Sources`,
      );
    }
    propertyByOldId.set(mapping.oldPropertyId, mapping);
  }
  const optionByOldCoordinate = new Map<string, OptionIdentityMapping>();
  const optionBearingProperties = new Set<string>();
  const unscopedOptionByOldId = new Map<string, string>();
  const ambiguousUnscopedOptionIds = new Set<string>();
  for (const mapping of optionMappings) {
    optionBearingProperties.add(
      mappingKey(mapping.dataSourceId, mapping.oldPropertyId),
    );
    optionByOldCoordinate.set(
      mappingKey(
        mapping.dataSourceId,
        mapping.oldPropertyId,
        mapping.oldOptionId,
      ),
      mapping,
    );
    const unscoped = unscopedOptionByOldId.get(mapping.oldOptionId);
    if (unscoped === undefined && !ambiguousUnscopedOptionIds.has(mapping.oldOptionId)) {
      unscopedOptionByOldId.set(mapping.oldOptionId, mapping.newOptionId);
    } else if (unscoped !== mapping.newOptionId) {
      unscopedOptionByOldId.delete(mapping.oldOptionId);
      ambiguousUnscopedOptionIds.add(mapping.oldOptionId);
    }
  }
  return {
    propertyByOldId,
    optionByOldCoordinate,
    optionBearingProperties,
    unscopedOptionByOldId,
    ambiguousUnscopedOptionIds,
  };
};

const requirePropertyMapping = (
  indexes: MappingIndexes,
  oldPropertyId: string,
): PropertyIdentityMapping => {
  const mapping = indexes.propertyByOldId.get(oldPropertyId);
  if (mapping) return mapping;
  throw new DatabaseIdentityCutoverError(
    `Missing Property identity mapping for ${oldPropertyId}`,
  );
};

const rewriteOptionValue = (
  indexes: MappingIndexes,
  property: PropertyIdentityMapping,
  value: string,
  required: boolean,
): string => {
  const mapping = indexes.optionByOldCoordinate.get(
    mappingKey(property.dataSourceId, property.oldPropertyId, value),
  );
  if (mapping) return mapping.newOptionId;
  if (
    !required &&
    !indexes.optionBearingProperties.has(
      mappingKey(property.dataSourceId, property.oldPropertyId),
    )
  ) {
    return value;
  }
  throw new DatabaseIdentityCutoverError(
    `Missing option identity mapping for ${property.oldPropertyId}/${value}`,
  );
};

const rewriteRequiredOptionValue = (
  indexes: MappingIndexes,
  property: PropertyIdentityMapping,
  value: string,
): DataSourceOptionId => {
  const rewritten = rewriteOptionValue(indexes, property, value, true);
  if (property.newPropertyId === "status" && isLegacyWorkflowStatus(rewritten)) {
    return rewritten as DataSourceOptionId;
  }
  return parseDataSourceOptionId({
    propertyId: property.newPropertyId,
    value: rewritten,
  });
};

const rewriteFilterValue = (
  indexes: MappingIndexes,
  property: PropertyIdentityMapping,
  value: DatabaseJsonValue,
): DatabaseJsonValue => {
  if (typeof value === "string") {
    return rewriteOptionValue(indexes, property, value, false);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === "string"
        ? rewriteOptionValue(indexes, property, entry, false)
        : entry,
    );
  }
  return value;
};

const rewriteFilter = (
  filter: DatabaseViewFilterNode,
  indexes: MappingIndexes,
): DatabaseViewFilterNode => {
  if (filter.kind === "group") {
    return {
      ...filter,
      children: filter.children.map((child) => rewriteFilter(child, indexes)),
    };
  }
  const property = requirePropertyMapping(indexes, filter.propertyId);
  return {
    ...filter,
    propertyId: property.newPropertyId,
    ...(filter.value === undefined
      ? {}
      : { value: rewriteFilterValue(indexes, property, filter.value) }),
  };
};

export const rewriteDatabaseViewConfigV1ToV2 = (input: {
  readonly config: unknown;
  readonly dataSourceId: string;
  readonly propertyMappings: readonly PropertyIdentityMapping[];
  readonly optionMappings: readonly OptionIdentityMapping[];
}): DatabaseViewConfigV2 => {
  const config = parseDatabaseViewConfig(input.config);
  const indexes = createMappingIndexes(
    input.propertyMappings.filter(
      (mapping) => mapping.dataSourceId === input.dataSourceId,
    ),
    input.optionMappings.filter(
      (mapping) => mapping.dataSourceId === input.dataSourceId,
    ),
  );
  const rewritePropertyId = (propertyId: string): DataSourcePropertyId =>
    requirePropertyMapping(indexes, propertyId).newPropertyId;
  const rewritten: DatabaseViewConfigV2 = {
    ...config,
    schemaVersion: 2,
    filter: rewriteFilter(config.filter, indexes),
    sort: config.sort.map((sort) =>
      sort.field.kind === "property"
        ? {
            ...sort,
            field: {
              kind: "property" as const,
              propertyId: rewritePropertyId(sort.field.propertyId),
            },
          }
        : sort,
    ),
    group: config.group
      ? { propertyId: rewritePropertyId(config.group.propertyId) }
      : null,
    display: {
      ...config.display,
      propertyIds: config.display.propertyIds.map(rewritePropertyId),
    },
  };
  return parseDatabaseViewConfigV2(rewritten);
};

export const rewriteDatabaseViewPositionGroupKey = (
  input: DatabaseViewPositionGroupKeyRewriteInput,
): string | null => {
  const indexes = createMappingIndexes(
    input.propertyMappings.filter(
      (mapping) => mapping.dataSourceId === input.dataSourceId,
    ),
    input.optionMappings.filter(
      (mapping) => mapping.dataSourceId === input.dataSourceId,
    ),
  );
  const property = requirePropertyMapping(indexes, input.oldPropertyId);
  const value = databaseGroupValueFromKey(input.valueType, input.groupKey);
  if (value === null) return null;
  if (input.valueType === "select") {
    if (typeof value !== "string") {
      throw new DatabaseIdentityCutoverError(
        `Select group key for ${input.oldPropertyId} is not a string`,
      );
    }
    return databaseGroupKeyForValue(
      rewriteRequiredOptionValue(indexes, property, value),
    );
  }
  if (input.valueType === "multi_select") {
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== "string")
    ) {
      throw new DatabaseIdentityCutoverError(
        `Multi-select group key for ${input.oldPropertyId} is not an option array`,
      );
    }
    const rewritten = (value as readonly string[])
      .map((optionId) =>
        rewriteRequiredOptionValue(indexes, property, optionId),
      )
      .sort(compareStrings);
    return databaseGroupKeyForValue(rewritten);
  }
  return databaseGroupKeyForValue(value);
};

const rewriteRequestField = (
  field: BlockPropertyFieldMutation,
  indexes: MappingIndexes,
): BlockPropertyFieldMutationV2 => {
  if (field.scope === "intrinsic") return field;
  const property = requirePropertyMapping(indexes, field.propertyId);
  if (field.operation === "set") {
    return {
      scope: "data_source",
      pageId: field.pageId,
      dataSourceId: property.dataSourceId,
      propertyId: property.newPropertyId,
      operation: "set",
      expectedRevision: field.expectedRevision,
      value:
        typeof field.value === "string"
          ? rewriteOptionValue(indexes, property, field.value, false)
          : field.value,
    };
  }
  return {
    scope: "data_source",
    pageId: field.pageId,
    dataSourceId: property.dataSourceId,
    propertyId: property.newPropertyId,
    operation: "add_remove",
    add: field.add.map((value) =>
      rewriteRequiredOptionValue(indexes, property, value),
    ),
    remove: field.remove.map((value) =>
      rewriteRequiredOptionValue(indexes, property, value),
    ),
  };
};

const rewriteResultField = (
  field: BlockPropertyMutationFieldResult,
  indexes: MappingIndexes,
): BlockPropertyMutationFieldResultV2 => {
  if (field.scope === "intrinsic") {
    return {
      path: makeBlockPropertyFieldPathV2({
        scope: "intrinsic",
        blockId: field.blockId,
        propertyKey: field.propertyKey ?? "",
        operation: "set",
        expectedRevision: 0,
        value: null,
      }),
      scope: "intrinsic",
      blockId: field.blockId,
      propertyKey: field.propertyKey ?? "",
      operation: "set",
      revision: field.revision,
      value: field.value,
    };
  }
  const property = requirePropertyMapping(indexes, field.propertyId ?? "");
  const value = field.operation === "add_remove"
    ? (field.value as readonly string[])
        .map((member) =>
          rewriteRequiredOptionValue(indexes, property, member),
        )
        .sort(compareStrings)
    : typeof field.value === "string"
      ? rewriteOptionValue(indexes, property, field.value, false)
      : field.value;
  const result: BlockPropertyMutationFieldResultV2 = {
    path: makeBlockPropertyFieldPathV2({
      scope: "data_source",
      pageId: field.blockId,
      dataSourceId: property.dataSourceId,
      propertyId: property.newPropertyId,
      operation: "set",
      expectedRevision: 0,
      value: null,
    }),
    scope: "data_source",
    blockId: field.blockId,
    dataSourceId: property.dataSourceId,
    propertyId: property.newPropertyId,
    operation: field.operation,
    revision: field.revision,
    value: value as string | null | readonly DataSourceOptionId[],
  };
  return result;
};

const parseJsonObject = (
  json: string,
  label: string,
): Readonly<Record<string, unknown>> => {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new DatabaseIdentityCutoverError(`${label} is not valid JSON`);
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  throw new DatabaseIdentityCutoverError(`${label} must be a JSON object`);
};

const requireEvidenceRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  throw new DatabaseIdentityCutoverError(`${label} must be an object`);
};

const rewriteMappedPropertyId = (
  indexes: MappingIndexes,
  propertyId: string,
): string =>
  indexes.propertyByOldId.get(propertyId)?.newPropertyId ?? propertyId;

const rewriteMappedOptionValue = (
  indexes: MappingIndexes,
  property: PropertyIdentityMapping,
  value: unknown,
): unknown => {
  if (typeof value === "string") {
    return indexes.optionByOldCoordinate.get(
      mappingKey(property.dataSourceId, property.oldPropertyId, value),
    )?.newOptionId ?? value;
  }
  if (!Array.isArray(value)) return value;
  return value.map((entry) =>
    typeof entry === "string"
      ? indexes.optionByOldCoordinate.get(
          mappingKey(property.dataSourceId, property.oldPropertyId, entry),
        )?.newOptionId ?? entry
      : entry,
  );
};

const rewriteUnscopedOptionId = (
  indexes: MappingIndexes,
  optionId: string,
): string => {
  if (indexes.ambiguousUnscopedOptionIds.has(optionId)) {
    throw new DatabaseIdentityCutoverError(
      `Historical Database operation option ${optionId} is ambiguous without Property scope`,
    );
  }
  return indexes.unscopedOptionByOldId.get(optionId) ?? optionId;
};

const rewriteHistoricalDatabaseGroupKey = (
  indexes: MappingIndexes,
  groupKey: string,
  property?: PropertyIdentityMapping,
): string => {
  const rewriteOption = (optionId: string): string => {
    if (!property) return rewriteUnscopedOptionId(indexes, optionId);
    return rewriteMappedOptionValue(
      indexes,
      property,
      optionId,
    ) as string;
  };
  const direct = rewriteOption(groupKey);
  if (direct !== groupKey) return direct;
  let parsed: unknown;
  try {
    parsed = JSON.parse(groupKey) as unknown;
  } catch {
    return groupKey;
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    return groupKey;
  }
  const rewritten = (parsed as readonly string[]).map((entry) =>
    rewriteOption(entry),
  );
  return rewritten.some((entry, index) => entry !== parsed[index])
    ? stableStringifyBlockPropertyJson(rewritten)
    : groupKey;
};

const rewriteHistoricalDatabasePath = (
  indexes: MappingIndexes,
  path: string,
): string => {
  const segments = path.split("/");
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== "property") continue;
    const encodedPropertyId = segments[index + 1];
    if (encodedPropertyId === undefined) continue;
    let propertyId: string;
    try {
      propertyId = decodeURIComponent(encodedPropertyId);
    } catch {
      throw new DatabaseIdentityCutoverError(
        `Historical Database operation field path ${path} is malformed`,
      );
    }
    segments[index + 1] = encodeURIComponent(
      rewriteMappedPropertyId(indexes, propertyId),
    );
  }
  return segments.join("/");
};

const rewriteHistoricalPropertyConfig = (input: {
  readonly indexes: MappingIndexes;
  readonly property: PropertyIdentityMapping;
  readonly valueType: DatabasePropertyValueType;
  readonly config: unknown;
}): Readonly<Record<string, DatabaseJsonValue>> => {
  const config = parseDatabasePropertyConfig(input.valueType, input.config);
  if (input.valueType !== "select" && input.valueType !== "multi_select") {
    return config;
  }
  const options = config.options;
  if (!Array.isArray(options)) {
    throw new DatabaseIdentityCutoverError(
      `Historical Property ${input.property.oldPropertyId} has no option registry`,
    );
  }
  return {
    ...config,
    options: options.map((candidate) => {
      const option = requireEvidenceRecord(
        candidate,
        `Historical Property ${input.property.oldPropertyId} option`,
      );
      if (typeof option.id !== "string") {
        throw new DatabaseIdentityCutoverError(
          `Historical Property ${input.property.oldPropertyId} option has no identity`,
        );
      }
      return {
        ...option,
        id: rewriteMappedOptionValue(
          input.indexes,
          input.property,
          option.id,
        ) as string,
      } as Readonly<Record<string, DatabaseJsonValue>>;
    }),
  };
};

const rewriteHistoricalViewFilter = (
  filter: DatabaseViewFilterNode,
  indexes: MappingIndexes,
): DatabaseViewFilterNode => {
  if (filter.kind === "group") {
    return {
      ...filter,
      children: filter.children.map((child) =>
        rewriteHistoricalViewFilter(child, indexes),
      ),
    };
  }
  const property = indexes.propertyByOldId.get(filter.propertyId);
  return {
    ...filter,
    propertyId: rewriteMappedPropertyId(indexes, filter.propertyId),
    ...(filter.value === undefined || property === undefined
      ? {}
      : {
          value: rewriteMappedOptionValue(
            indexes,
            property,
            filter.value,
          ) as DatabaseJsonValue,
        }),
  };
};

const rewriteHistoricalDatabaseViewConfig = (
  configValue: unknown,
  indexes: MappingIndexes,
): ReturnType<typeof parseDatabaseViewConfig> => {
  const config = parseDatabaseViewConfig(configValue);
  return parseDatabaseViewConfig({
    ...config,
    filter: rewriteHistoricalViewFilter(config.filter, indexes),
    sort: config.sort.map((sort) =>
      sort.field.kind === "property"
        ? {
            ...sort,
            field: {
              ...sort.field,
              propertyId: rewriteMappedPropertyId(
                indexes,
                sort.field.propertyId,
              ),
            },
          }
        : sort,
    ),
    group: config.group
      ? {
          propertyId: rewriteMappedPropertyId(
            indexes,
            config.group.propertyId,
          ),
        }
      : null,
    display: {
      ...config.display,
      propertyIds: config.display.propertyIds.map((propertyId) =>
        rewriteMappedPropertyId(indexes, propertyId),
      ),
    },
  });
};

const rewriteHistoricalDatabaseEvidenceValue = (
  value: unknown,
  indexes: MappingIndexes,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      rewriteHistoricalDatabaseEvidenceValue(entry, indexes),
    );
  }
  if (typeof value !== "object" || value === null) return value;
  const record = value as Readonly<Record<string, unknown>>;
  if (
    record.schemaKey === "nodex.database-view" &&
    record.schemaVersion === 1
  ) {
    return rewriteHistoricalDatabaseViewConfig(record, indexes);
  }
  const property = typeof record.propertyId === "string"
    ? indexes.propertyByOldId.get(record.propertyId)
    : undefined;
  const rewritten: Record<string, unknown> = {};
  for (const [key, candidate] of Object.entries(record)) {
    if (
      (key === "propertyId" || key === "beforePropertyId") &&
      typeof candidate === "string"
    ) {
      rewritten[key] = rewriteMappedPropertyId(indexes, candidate);
      continue;
    }
    if (key === "path" && typeof candidate === "string") {
      rewritten[key] = rewriteHistoricalDatabasePath(indexes, candidate);
      continue;
    }
    if (key === "groupKey" && typeof candidate === "string") {
      rewritten[key] = rewriteHistoricalDatabaseGroupKey(
        indexes,
        candidate,
        property,
      );
      continue;
    }
    if (key === "groupedPositionRevisions") {
      const revisions = requireEvidenceRecord(
        candidate,
        "Historical Database grouped position revisions",
      );
      const entries = Object.entries(revisions).map(([groupKey, revision]) => [
        rewriteHistoricalDatabaseGroupKey(indexes, groupKey, property),
        revision,
      ] as const);
      if (new Set(entries.map(([groupKey]) => groupKey)).size !== entries.length) {
        throw new DatabaseIdentityCutoverError(
          "Historical Database grouped position revisions collide after option rewriting",
        );
      }
      rewritten[key] = Object.fromEntries(entries);
      continue;
    }
    if (
      property &&
      (key === "value" || key === "add" || key === "remove")
    ) {
      rewritten[key] = rewriteMappedOptionValue(indexes, property, candidate);
      continue;
    }
    if (
      key === "config" &&
      property &&
      typeof record.valueType === "string" &&
      [
        "text",
        "number",
        "checkbox",
        "select",
        "multi_select",
        "date",
        "datetime",
        "person",
      ].includes(record.valueType)
    ) {
      rewritten[key] = rewriteHistoricalPropertyConfig({
        indexes,
        property,
        valueType: record.valueType as DatabasePropertyValueType,
        config: candidate,
      });
      continue;
    }
    rewritten[key] = rewriteHistoricalDatabaseEvidenceValue(candidate, indexes);
  }
  return rewritten;
};

const DATABASE_OPERATION_KINDS = new Set([
  "create_database",
  "put_property",
  "delete_property",
  "transfer_membership",
  "put_view",
  "delete_view",
  "position_card",
  "position_cards",
  "position_page",
  "position_pages",
  "set_value",
  "set_values",
  "add_remove_value",
]);

const readHistoricalDatabaseOperationKinds = (
  value: unknown,
  label: string,
): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DatabaseIdentityCutoverError(`${label} must be a non-empty array`);
  }
  return value.map((candidate, index) => {
    if (typeof candidate === "string") {
      if (DATABASE_OPERATION_KINDS.has(candidate)) return candidate;
      throw new DatabaseIdentityCutoverError(
        `${label}[${index}] is unsupported`,
      );
    }
    const operation = requireEvidenceRecord(candidate, `${label}[${index}]`);
    if (
      typeof operation.kind !== "string" ||
      !DATABASE_OPERATION_KINDS.has(operation.kind)
    ) {
      throw new DatabaseIdentityCutoverError(
        `${label}[${index}] has an unsupported kind`,
      );
    }
    return operation.kind;
  });
};

export const rewriteCommittedDatabaseOperationEvidence = (input: {
  readonly evidence: DatabaseOperationEvidenceAggregate;
  readonly propertyMappings: readonly PropertyIdentityMapping[];
  readonly optionMappings: readonly OptionIdentityMapping[];
}): DatabaseOperationEvidenceRewriteResult => {
  if (input.evidence.mutationKind !== "database_operation") {
    return { kind: "unknown_evidence", reason: "not_database_operation" };
  }
  if (input.evidence.outcome === "rejected") {
    return {
      kind: "retained_rejected",
      reason: "rejected_evidence_is_literal",
    };
  }
  if (input.evidence.outcome !== "committed") {
    return { kind: "unknown_evidence", reason: "unknown_outcome" };
  }
  if (input.evidence.changePayloadJson === null) {
    throw new DatabaseIdentityCutoverError(
      "Committed Database operation evidence has no linked change payload",
    );
  }
  const request = parseJsonObject(
    input.evidence.requestJson,
    "Database operation request",
  );
  if (request.version !== 1) {
    throw new DatabaseIdentityCutoverError(
      "Committed Database operation request is not schema version 1",
    );
  }
  const requestKinds = readHistoricalDatabaseOperationKinds(
    request.operations,
    "Database operation request operations",
  );
  if (
    stableStringifyBlockPropertyJson(request) !== input.evidence.requestJson ||
    createHash("sha256").update(input.evidence.requestJson).digest("hex") !==
      input.evidence.requestHash
  ) {
    throw new DatabaseIdentityCutoverError(
      "Committed Database operation request hash or canonical JSON is corrupt",
    );
  }
  const result = parseJsonObject(
    input.evidence.resultJson,
    "Database operation result",
  );
  if (result.version !== 1) {
    throw new DatabaseIdentityCutoverError(
      "Committed Database operation result is not schema version 1",
    );
  }
  const resultKinds = readHistoricalDatabaseOperationKinds(
    result.operationKinds,
    "Database operation result kinds",
  );
  if (
    stableStringifyBlockPropertyJson(requestKinds) !==
    stableStringifyBlockPropertyJson(resultKinds)
  ) {
    throw new DatabaseIdentityCutoverError(
      "Committed Database operation request and result kinds diverge",
    );
  }
  const expectedRevisions = parseJsonObject(
    input.evidence.expectedRevisionsJson,
    "Database operation expected revisions",
  );
  const committedRevisions = parseJsonObject(
    input.evidence.committedRevisionsJson,
    "Database operation committed revisions",
  );
  const fieldIntents = parseJsonArray(
    input.evidence.fieldIntentsJson,
    "Database operation field intents",
  );
  for (const [index, candidate] of fieldIntents.entries()) {
    const field = requireEvidenceRecord(
      candidate,
      `Database operation field intent ${index}`,
    );
    if (typeof field.operation !== "string" || typeof field.path !== "string") {
      throw new DatabaseIdentityCutoverError(
        `Database operation field intent ${index} has an invalid shape`,
      );
    }
  }
  const changePayload = parseJsonObject(
    input.evidence.changePayloadJson,
    "Database operation change payload",
  );
  if (
    changePayload.version !== 1 ||
    changePayload.mutationKind !== "database_operation" ||
    changePayload.requestHash !== input.evidence.requestHash ||
    stableStringifyBlockPropertyJson(changePayload.operationKinds) !==
      stableStringifyBlockPropertyJson(resultKinds) ||
    stableStringifyBlockPropertyJson(changePayload.payload) !==
      stableStringifyBlockPropertyJson(result.payload) ||
    stableStringifyBlockPropertyJson(changePayload.committedRevisions) !==
      stableStringifyBlockPropertyJson(committedRevisions)
  ) {
    throw new DatabaseIdentityCutoverError(
      "Committed Database operation change payload diverges from its ledger",
    );
  }
  const indexes = createMappingIndexes(
    input.propertyMappings,
    input.optionMappings,
  );
  const requestJson = stableStringifyBlockPropertyJson(
    rewriteHistoricalDatabaseEvidenceValue(request, indexes),
  );
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  const rewrittenFieldIntents = rewriteHistoricalDatabaseEvidenceValue(
    fieldIntents,
    indexes,
  );
  const rewrittenExpectedRevisions = Object.fromEntries(
    Object.entries(expectedRevisions).map(([key, revision]) => [
      rewriteHistoricalDatabasePath(indexes, key),
      revision,
    ]),
  );
  const rewrittenCommittedRevisions = Object.fromEntries(
    Object.entries(committedRevisions).map(([key, revision]) => [
      rewriteHistoricalDatabasePath(indexes, key),
      revision,
    ]),
  );
  const rewrittenResult = requireEvidenceRecord(
    rewriteHistoricalDatabaseEvidenceValue(result, indexes),
    "Rewritten Database operation result",
  );
  const rewrittenChangePayload = requireEvidenceRecord(
    rewriteHistoricalDatabaseEvidenceValue(changePayload, indexes),
    "Rewritten Database operation change payload",
  );
  return {
    kind: "rewritten_committed_database_operation",
    evidence: {
      requestJson,
      requestHash,
      fieldIntentsJson: stableStringifyBlockPropertyJson(rewrittenFieldIntents),
      expectedRevisionsJson: stableStringifyBlockPropertyJson(
        rewrittenExpectedRevisions,
      ),
      resultJson: stableStringifyBlockPropertyJson(rewrittenResult),
      committedRevisionsJson: stableStringifyBlockPropertyJson(
        rewrittenCommittedRevisions,
      ),
      changePayloadJson: stableStringifyBlockPropertyJson({
        ...rewrittenChangePayload,
        requestHash,
        payload: rewrittenResult.payload,
        committedRevisions: rewrittenCommittedRevisions,
      }),
    },
  };
};

const rewriteHistoricalValue = (
  value: unknown,
  oldField: BlockPropertyMutationFieldResult,
  indexes: MappingIndexes,
): BlockPropertyJsonValueV2 => {
  if (oldField.scope === "intrinsic") return value as BlockPropertyJsonValueV2;
  const property = requirePropertyMapping(indexes, oldField.propertyId ?? "");
  if (Array.isArray(value)) {
    if (
      oldField.operation === "add_remove" &&
      value.some((entry) => typeof entry !== "string")
    ) {
      throw new DatabaseIdentityCutoverError(
        `Committed Property snapshot ${oldField.path} is not an option set`,
      );
    }
    return value
      .map((entry) =>
        typeof entry === "string"
          ? rewriteOptionValue(indexes, property, entry, true)
          : (entry as BlockPropertyJsonValueV2),
      )
      .sort((left, right) =>
        typeof left === "string" && typeof right === "string"
          ? compareStrings(left, right)
          : 0,
      );
  }
  if (typeof value === "string") {
    return rewriteOptionValue(indexes, property, value, false);
  }
  return value as BlockPropertyJsonValueV2;
};

const rewriteChangePayload = (input: {
  readonly payloadJson: string;
  readonly oldRequestHash: string;
  readonly requestHash: string;
  readonly oldFields: readonly BlockPropertyMutationFieldResult[];
  readonly newFields: readonly BlockPropertyMutationFieldResultV2[];
  readonly indexes: MappingIndexes;
}): string => {
  const payload = parseJsonObject(input.payloadJson, "change payload");
  if (payload.version !== 1) {
    throw new DatabaseIdentityCutoverError(
      "Committed Property change payload is not schema version 1",
    );
  }
  if (payload.requestHash !== input.oldRequestHash) {
    throw new DatabaseIdentityCutoverError(
      "Committed Property change payload requestHash diverges from its ledger",
    );
  }
  if (
    stableStringifyBlockPropertyJson(payload.fieldPaths) !==
    stableStringifyBlockPropertyJson(
      input.oldFields.map((field) => field.path),
    )
  ) {
    throw new DatabaseIdentityCutoverError(
      "Committed Property change payload fieldPaths diverges from its result",
    );
  }
  const oldCommittedRevisions = Object.fromEntries(
    input.oldFields.map((field) => [field.path, field.revision]),
  );
  if (
    stableStringifyBlockPropertyJson(payload.committedRevisions) !==
    stableStringifyBlockPropertyJson(oldCommittedRevisions)
  ) {
    throw new DatabaseIdentityCutoverError(
      "Committed Property change payload revisions diverge from its result",
    );
  }
  if (!Array.isArray(payload.fieldChanges)) {
    throw new DatabaseIdentityCutoverError(
      "Committed Property change payload has no fieldChanges array",
    );
  }
  const newByOldPath = new Map(
    input.oldFields.map((field, index) => [
      field.path,
      { oldField: field, newField: input.newFields[index] },
    ]),
  );
  const seenChangePaths = new Set<string>();
  const fieldChanges = payload.fieldChanges.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new DatabaseIdentityCutoverError(
        "Committed Property fieldChanges contains a non-object",
      );
    }
    const change = candidate as Readonly<Record<string, unknown>>;
    if (typeof change.path !== "string") {
      throw new DatabaseIdentityCutoverError(
        "Committed Property fieldChanges entry has no path",
      );
    }
    const matched = newByOldPath.get(change.path);
    if (!matched?.newField) {
      throw new DatabaseIdentityCutoverError(
        `Committed Property fieldChanges has unknown path ${change.path}`,
      );
    }
    if (seenChangePaths.has(change.path)) {
      throw new DatabaseIdentityCutoverError(
        `Committed Property fieldChanges repeats path ${change.path}`,
      );
    }
    seenChangePaths.add(change.path);
    const rewriteSnapshot = (snapshot: unknown): unknown => {
      if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
        throw new DatabaseIdentityCutoverError(
          `Committed Property change ${change.path} has an invalid snapshot`,
        );
      }
      const record = snapshot as Readonly<Record<string, unknown>>;
      return {
        ...record,
        ...(Object.hasOwn(record, "value")
          ? {
              value: rewriteHistoricalValue(
                record.value,
                matched.oldField,
                input.indexes,
              ),
            }
          : {}),
      };
    };
    return {
      ...change,
      path: matched.newField.path,
      scope: matched.newField.scope,
      before: rewriteSnapshot(change.before),
      after: rewriteSnapshot(change.after),
    };
  });
  if (
    fieldChanges.length !== input.oldFields.length ||
    seenChangePaths.size !== input.oldFields.length
  ) {
    throw new DatabaseIdentityCutoverError(
      "Committed Property fieldChanges does not cover every result field",
    );
  }
  const committedRevisions = Object.fromEntries(
    input.newFields.map((field) => [field.path, field.revision]),
  );
  return stableStringifyBlockPropertyJsonV2({
    ...payload,
    version: BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION,
    requestHash: input.requestHash,
    fieldPaths: input.newFields.map((field) => field.path),
    fieldChanges,
    committedRevisions,
  });
};

const normalizeHistoricalCardPropertyEvidence = (
  evidence: BlockPropertyEvidenceAggregate,
): BlockPropertyEvidenceAggregate => {
  const request = parseJsonObject(
    evidence.requestJson,
    "Block Property request",
  );
  if (!Array.isArray(request.fields)) return evidence;
  let changed = false;
  const fields = request.fields.map((candidate, index) => {
    const field = requireEvidenceRecord(
      candidate,
      `Historical Block Property field ${index}`,
    );
    if (field.scope !== "database" || field.cardBlockId === undefined) {
      return field;
    }
    if (typeof field.cardBlockId !== "string" || field.pageId !== undefined) {
      throw new DatabaseIdentityCutoverError(
        `Historical Block Property field ${index} has ambiguous Card/Page identity`,
      );
    }
    changed = true;
    const { cardBlockId, ...rest } = field;
    return { ...rest, pageId: cardBlockId };
  });
  if (!changed) return evidence;
  const originalHash = createHash("sha256")
    .update(evidence.requestJson)
    .digest("hex");
  if (
    stableStringifyBlockPropertyJson(request) !== evidence.requestJson ||
    originalHash !== evidence.requestHash
  ) {
    throw new DatabaseIdentityCutoverError(
      "Historical Block Property request hash or canonical JSON is corrupt",
    );
  }
  if (evidence.changePayloadJson === null) {
    throw new DatabaseIdentityCutoverError(
      "Historical Block Property evidence has no linked change payload",
    );
  }
  const changePayload = parseJsonObject(
    evidence.changePayloadJson,
    "Historical Block Property change payload",
  );
  if (changePayload.requestHash !== evidence.requestHash) {
    throw new DatabaseIdentityCutoverError(
      "Historical Block Property change payload requestHash diverges from its ledger",
    );
  }
  const requestJson = canonicalizeBlockPropertyMutationRequest({
    ...request,
    fields,
  });
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  return {
    ...evidence,
    requestJson,
    requestHash,
    changePayloadJson: stableStringifyBlockPropertyJson({
      ...changePayload,
      requestHash,
    }),
  };
};

export const rewriteCommittedBlockPropertyEvidence = (input: {
  readonly evidence: BlockPropertyEvidenceAggregate;
  readonly propertyMappings: readonly PropertyIdentityMapping[];
  readonly optionMappings: readonly OptionIdentityMapping[];
}): BlockPropertyEvidenceRewriteResult => {
  if (input.evidence.mutationKind !== "property_batch") {
    return { kind: "unknown_evidence", reason: "not_property_batch" };
  }
  if (input.evidence.outcome === "rejected") {
    return {
      kind: "retained_rejected",
      reason: "rejected_evidence_is_literal",
    };
  }
  if (input.evidence.outcome !== "committed") {
    return { kind: "unknown_evidence", reason: "unknown_outcome" };
  }
  if (input.evidence.changePayloadJson === null) {
    throw new DatabaseIdentityCutoverError(
      "Committed Property evidence has no linked change payload",
    );
  }
  const evidence = normalizeHistoricalCardPropertyEvidence(input.evidence);
  const oldRequestObject = parseJsonObject(
    evidence.requestJson,
    "Block Property request",
  );
  const oldRequest = parseBlockPropertyMutationRequest(oldRequestObject);
  const oldCanonicalRequest = canonicalizeBlockPropertyMutationRequest(
    oldRequestObject,
  );
  const oldHash = createHash("sha256")
    .update(evidence.requestJson)
    .digest("hex");
  if (
    oldCanonicalRequest !== evidence.requestJson ||
    oldHash !== evidence.requestHash
  ) {
    throw new DatabaseIdentityCutoverError(
      "Committed Property request hash or canonical JSON is corrupt",
    );
  }
  const oldFieldIntents = oldRequest.fields.map((field) => ({
    path: makeBlockPropertyFieldPath(field),
    operation: field.operation,
    scope: field.scope,
    ...(field.operation === "add_remove"
      ? { add: field.add, remove: field.remove }
      : {}),
  }));
  const oldExpectedRevisions = Object.fromEntries(
    oldRequest.fields.flatMap((field) =>
      field.operation === "set"
        ? [[makeBlockPropertyFieldPath(field), field.expectedRevision] as const]
        : [],
    ),
  );
  if (
    stableStringifyBlockPropertyJson(oldFieldIntents) !==
      evidence.fieldIntentsJson ||
    stableStringifyBlockPropertyJson(oldExpectedRevisions) !==
      evidence.expectedRevisionsJson
  ) {
    throw new DatabaseIdentityCutoverError(
      "Committed Property request intents diverge from its ledger",
    );
  }
  const indexes = createMappingIndexes(
    input.propertyMappings,
    input.optionMappings,
  );
  const fields = oldRequest.fields.map((field) =>
    rewriteRequestField(field, indexes),
  );
  const request = parseBlockPropertyMutationRequestV2({
    ...oldRequest,
    version: BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION,
    fields,
  });
  const requestJson = canonicalizeBlockPropertyMutationRequestV2(request);
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  const fieldIntents = request.fields.map((field) => ({
    path: makeBlockPropertyFieldPathV2(field),
    operation: field.operation,
    scope: field.scope,
    ...(field.operation === "add_remove"
      ? { add: field.add, remove: field.remove }
      : {}),
  }));
  const expectedRevisions = Object.fromEntries(
    request.fields.flatMap((field) =>
      field.operation === "set"
        ? [[makeBlockPropertyFieldPathV2(field), field.expectedRevision] as const]
        : [],
    ),
  );
  const oldResult = parseBlockPropertyMutationResult(
    parseJsonObject(evidence.resultJson, "Block Property result"),
  );
  const oldResultPaths = oldResult.fields.map((field) => field.path);
  const oldRequestPaths = oldRequest.fields.map(makeBlockPropertyFieldPath);
  if (
    stableStringifyBlockPropertyJson(oldResultPaths) !==
    stableStringifyBlockPropertyJson(oldRequestPaths)
  ) {
    throw new DatabaseIdentityCutoverError(
      "Committed Property request and result field paths diverge",
    );
  }
  const oldCommittedRevisions = Object.fromEntries(
    oldResult.fields.map((field) => [field.path, field.revision]),
  );
  if (
    stableStringifyBlockPropertyJson(oldCommittedRevisions) !==
    evidence.committedRevisionsJson
  ) {
    throw new DatabaseIdentityCutoverError(
      "Committed Property result revisions diverge from its ledger",
    );
  }
  const rewrittenResultFields = oldResult.fields.map((field) =>
    rewriteResultField(field, indexes),
  );
  const result = parseBlockPropertyMutationResultV2({
    ...oldResult,
    version: BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION,
    fields: rewrittenResultFields,
  });
  const committedRevisions = Object.fromEntries(
    result.fields.map((field) => [field.path, field.revision]),
  );
  const changePayloadJson = rewriteChangePayload({
    payloadJson: evidence.changePayloadJson ?? "",
    oldRequestHash: evidence.requestHash,
    requestHash,
    oldFields: oldResult.fields,
    newFields: result.fields,
    indexes,
  });
  return {
    kind: "rewritten_committed",
    evidence: {
      requestJson,
      requestHash,
      fieldIntentsJson: stableStringifyBlockPropertyJsonV2(fieldIntents),
      expectedRevisionsJson:
        stableStringifyBlockPropertyJsonV2(expectedRevisions),
      resultJson: stableStringifyBlockPropertyJsonV2(result),
      committedRevisionsJson:
        stableStringifyBlockPropertyJsonV2(committedRevisions),
      changePayloadJson,
    },
  };
};

export const makePageLifecycleTagOptionFieldIntentPathV2 = (input: {
  readonly dataSourceId: string;
  readonly optionId: DataSourceOptionId;
}): string =>
  `data_source/${encodeURIComponent(input.dataSourceId)}/properties/tags/options/${encodeURIComponent(input.optionId)}`;

const parseJsonArray = (json: string, label: string): readonly unknown[] => {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new DatabaseIdentityCutoverError(`${label} is not valid JSON`);
  }
  if (Array.isArray(value)) return value;
  throw new DatabaseIdentityCutoverError(`${label} must be a JSON array`);
};

const readStringArray = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new DatabaseIdentityCutoverError(`${label} must be a string array`);
  }
  const strings = value as readonly string[];
  if (new Set(strings).size !== strings.length) {
    throw new DatabaseIdentityCutoverError(`${label} must not contain duplicates`);
  }
  return strings;
};

const parseLifecycleFieldIntents = (
  json: string,
): readonly Readonly<{ path: string; operation: string }>[] =>
  parseJsonArray(json, "Page Lifecycle field intents").map(
    (candidate, index) => {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        Array.isArray(candidate)
      ) {
        throw new DatabaseIdentityCutoverError(
          `Page Lifecycle field intent ${index} must be an object`,
        );
      }
      const record = candidate as Readonly<Record<string, unknown>>;
      if (
        Object.keys(record).sort().join(",") !== "operation,path" ||
        typeof record.path !== "string" ||
        typeof record.operation !== "string" ||
        !record.path ||
        !record.operation
      ) {
        throw new DatabaseIdentityCutoverError(
          `Page Lifecycle field intent ${index} has an invalid shape`,
        );
      }
      return { path: record.path, operation: record.operation };
    },
  );

const oldTagOptionFieldIntentPath = (input: {
  readonly databaseId: string;
  readonly oldPropertyId: string;
  readonly oldOptionId: string;
}): string =>
  `databases.${input.databaseId}.properties.${input.oldPropertyId}.options.${input.oldOptionId}`;

export const rewriteCommittedPageLifecycleCreateEvidence = (input: {
  readonly evidence: PageLifecycleCreateEvidenceAggregate;
  readonly oldTagsPropertyId: string;
  readonly propertyMappings: readonly PropertyIdentityMapping[];
  readonly optionMappings: readonly OptionIdentityMapping[];
}): PageLifecycleCreateEvidenceRewriteResult => {
  if (input.evidence.mutationKind !== "page_lifecycle") {
    return { kind: "unknown_evidence", reason: "not_page_lifecycle" };
  }
  if (input.evidence.outcome === "rejected") {
    return {
      kind: "retained_rejected",
      reason: "rejected_evidence_is_literal",
    };
  }
  if (input.evidence.outcome !== "committed") {
    return { kind: "unknown_evidence", reason: "unknown_outcome" };
  }
  if (input.evidence.changePayloadJson === null) {
    throw new DatabaseIdentityCutoverError(
      "Committed Page Lifecycle evidence has no linked change payload",
    );
  }
  const logicalRequest = parseJsonObject(
    input.evidence.requestJson,
    "Page Lifecycle logical request",
  );
  if (
    Object.keys(logicalRequest).sort().join(",") !==
      "operation,projectId,version" ||
    logicalRequest.version !== 1 ||
    typeof logicalRequest.projectId !== "string"
  ) {
    throw new DatabaseIdentityCutoverError(
      "Page Lifecycle logical request is not the canonical v1 shape",
    );
  }
  if (
    stableStringifyBlockPropertyJson(logicalRequest) !==
    input.evidence.requestJson
  ) {
    throw new DatabaseIdentityCutoverError(
      "Page Lifecycle logical request is not canonical JSON",
    );
  }
  const oldHash = createHash("sha256")
    .update(input.evidence.requestJson)
    .digest("hex");
  if (oldHash !== input.evidence.requestHash) {
    throw new DatabaseIdentityCutoverError(
      "Page Lifecycle logical request hash is corrupt",
    );
  }
  const oldReceipt = parsePageLifecycleMutationReceipt(
    parseJsonObject(input.evidence.resultJson, "Page Lifecycle result"),
  );
  if (
    oldReceipt.operationKind !== "create_page" ||
    oldReceipt.dataSourceId === null ||
    oldReceipt.databaseId === null
  ) {
    return { kind: "unknown_evidence", reason: "not_create_page" };
  }
  const databaseId = oldReceipt.databaseId;
  const oldOperation = logicalRequest.operation;
  if (
    typeof oldOperation !== "object"
    || oldOperation === null
    || Array.isArray(oldOperation)
  ) {
    throw new DatabaseIdentityCutoverError(
      "Page Lifecycle logical request is not a canonical v80 create operation",
    );
  }
  const historicalOperation = oldOperation as Record<string, unknown>;
  if (
    historicalOperation.kind !== "create_page"
    || !isLegacyWorkflowStatus(historicalOperation.status)
  ) {
    throw new DatabaseIdentityCutoverError(
      "Page Lifecycle logical request is not a canonical v80 create operation",
    );
  }
  const legacyStatus = historicalOperation.status;
  const oldRequest = parsePageLifecycleMutationRequest({
    version: 1,
    operationId: oldReceipt.operationId,
    projectId: logicalRequest.projectId,
    storeEpoch: oldReceipt.storeEpoch,
    actor: {},
    operation: {
      ...historicalOperation,
      status: WORKFLOW_STATUS_CUTOVER_MAP[legacyStatus],
    },
  });
  if (oldRequest.operation.kind !== "create_page") {
    return { kind: "unknown_evidence", reason: "not_create_page" };
  }
  if (
    oldRequest.projectId !== oldReceipt.projectId ||
    oldRequest.operation.pageId !== oldReceipt.pageId
  ) {
    throw new DatabaseIdentityCutoverError(
      "Page Lifecycle create request and receipt coordinates diverge",
    );
  }
  const indexes = createMappingIndexes(
    input.propertyMappings,
    input.optionMappings,
  );
  const tagsProperty = requirePropertyMapping(
    indexes,
    input.oldTagsPropertyId,
  );
  if (
    tagsProperty.dataSourceId !== oldReceipt.dataSourceId ||
    tagsProperty.newPropertyId !== "tags"
  ) {
    throw new DatabaseIdentityCutoverError(
      "Page Lifecycle create evidence does not map to its reserved tags Property",
    );
  }
  const changePayload = parseJsonObject(
    input.evidence.changePayloadJson,
    "Page Lifecycle change payload",
  );
  if (
    changePayload.mutationKind !== "page_lifecycle" ||
    changePayload.requestHash !== input.evidence.requestHash ||
    changePayload.operation !== "create_page"
  ) {
    throw new DatabaseIdentityCutoverError(
      "Page Lifecycle create change payload diverges from its ledger",
    );
  }
  const createdOldOptionIds = readStringArray(
    changePayload.createdTagOptionIds,
    "Page Lifecycle createdTagOptionIds",
  );
  const requestedTags = new Set(oldRequest.operation.tags);
  if (createdOldOptionIds.some((optionId) => !requestedTags.has(optionId))) {
    throw new DatabaseIdentityCutoverError(
      "Page Lifecycle createdTagOptionIds are not present in create tags",
    );
  }
  const createdOptions = createdOldOptionIds.map((oldOptionId) => ({
    oldOptionId,
    newOptionId: rewriteRequiredOptionValue(
      indexes,
      tagsProperty,
      oldOptionId,
    ),
  }));
  const createdNewOptionIds = createdOptions.map(
    (option) => option.newOptionId,
  );
  const oldIntents = parseLifecycleFieldIntents(input.evidence.fieldIntentsJson);
  const createdIntentByPath = new Map(
    createdOptions.map(({ oldOptionId, newOptionId }) => [
      oldTagOptionFieldIntentPath({
        databaseId,
        oldPropertyId: input.oldTagsPropertyId,
        oldOptionId,
      }),
      newOptionId,
    ]),
  );
  const seenCreatedIntents = new Set<string>();
  const fieldIntents = oldIntents.map((intent) => {
    const optionId = createdIntentByPath.get(intent.path);
    if (!optionId) return intent;
    if (intent.operation !== "add" || seenCreatedIntents.has(intent.path)) {
      throw new DatabaseIdentityCutoverError(
        `Page Lifecycle tag option intent ${intent.path} is invalid`,
      );
    }
    seenCreatedIntents.add(intent.path);
    return {
      path: makePageLifecycleTagOptionFieldIntentPathV2({
        dataSourceId: tagsProperty.dataSourceId,
        optionId,
      }),
      operation: "add",
    };
  });
  if (seenCreatedIntents.size !== createdIntentByPath.size) {
    throw new DatabaseIdentityCutoverError(
      "Page Lifecycle createdTagOptionIds and field intents diverge",
    );
  }
  return {
    kind: "rewritten_committed_create",
    evidence: {
      requestJson: input.evidence.requestJson,
      requestHash: input.evidence.requestHash,
      fieldIntentsJson: stableStringifyBlockPropertyJson(fieldIntents),
      resultJson: input.evidence.resultJson,
      changePayloadJson: stableStringifyBlockPropertyJson({
        ...changePayload,
        createdTagOptionIds: createdNewOptionIds,
      }),
    },
  };
};
