import {
  canonicalizeTagName,
  isCustomDataSourcePropertyId,
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
  type DataSourceId,
  type DataSourceOptionId,
  type DataSourcePropertyId,
} from "./database-identities";

export const MAX_DATA_SOURCE_PROPERTY_OPTIONS = 10_000;
export const MAX_DATA_SOURCE_OPTION_NAME_LENGTH = 256;
export const MAX_DATA_SOURCE_OPTION_COLOR_LENGTH = 256;

export type DataSourceOptionRegistryValueType = "select" | "multi_select";

export interface DataSourceOptionRegistryEntry {
  readonly optionId: DataSourceOptionId;
  readonly name: string;
  readonly color?: string;
}

export interface DataSourceOptionRegistry {
  readonly dataSourceId: DataSourceId;
  readonly propertyId: DataSourcePropertyId;
  readonly valueType: DataSourceOptionRegistryValueType;
  readonly options: readonly DataSourceOptionRegistryEntry[];
}

export interface ParseDataSourceOptionRegistryInput {
  readonly dataSourceId: unknown;
  readonly propertyId: unknown;
  readonly valueType: unknown;
  readonly config: unknown;
}

export interface PutDataSourceOptionInput {
  readonly optionId: unknown;
  readonly name: unknown;
  readonly color?: unknown;
}

export interface DeleteDataSourceOptionInput {
  readonly optionId: unknown;
  /** Every current persisted selection for this Property. */
  readonly selectedValues: readonly unknown[];
}

export type DataSourceOptionSelection =
  | null
  | DataSourceOptionId
  | readonly DataSourceOptionId[];

export type DataSourceOptionRegistryErrorCode =
  | "invalid_registry"
  | "invalid_selection"
  | "option_in_use"
  | "option_name_conflict"
  | "option_not_found";

export class DataSourceOptionRegistryError extends Error {
  constructor(
    readonly code: DataSourceOptionRegistryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DataSourceOptionRegistryError";
  }
}

const OPTION_CAPABLE_BUILT_IN_PROPERTIES = new Set([
  "status",
  "priority",
  "estimate",
  "tags",
]);

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const fail = (
  code: DataSourceOptionRegistryErrorCode,
  message: string,
  cause?: unknown,
): never => {
  throw new DataSourceOptionRegistryError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  return fail("invalid_registry", `${label} must be an object`);
};

const requireExactKeys = (
  value: Readonly<Record<string, unknown>>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (Object.prototype.hasOwnProperty.call(value, key)) continue;
    fail("invalid_registry", `${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    fail("invalid_registry", `${label}.${key} is not supported`);
  }
};

const requireCanonicalString = (
  value: unknown,
  label: string,
  maximumLength: number,
): string => {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim()
  ) {
    return value;
  }
  return fail(
    "invalid_registry",
    `${label} must be a canonical non-empty string of at most ${maximumLength} characters`,
  );
};

const parseRegistryCoordinates = (input: {
  readonly dataSourceId: unknown;
  readonly propertyId: unknown;
}): {
  readonly dataSourceId: DataSourceId;
  readonly propertyId: DataSourcePropertyId;
} => {
  try {
    return {
      dataSourceId: parseDataSourceId(input.dataSourceId),
      propertyId: parseDataSourcePropertyId(input.propertyId),
    };
  } catch (error) {
    return fail(
      "invalid_registry",
      `Option registry owner is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    );
  }
};

const parseRegistryValueType = (
  value: unknown,
): DataSourceOptionRegistryValueType => {
  if (value === "select" || value === "multi_select") return value;
  return fail(
    "invalid_registry",
    "Option registry valueType must be select or multi_select",
  );
};

const validatePropertyRole = (
  propertyId: DataSourcePropertyId,
  valueType: DataSourceOptionRegistryValueType,
): void => {
  if (isCustomDataSourcePropertyId(propertyId)) return;
  if (!OPTION_CAPABLE_BUILT_IN_PROPERTIES.has(propertyId)) {
    fail(
      "invalid_registry",
      `Built-in Property ${propertyId} cannot own an option registry`,
    );
  }
  if (propertyId === "tags" && valueType === "multi_select") return;
  if (propertyId !== "tags" && valueType === "select") return;
  fail(
    "invalid_registry",
    `Built-in Property ${propertyId} cannot use ${valueType}`,
  );
};

const parseOptionId = (
  propertyId: DataSourcePropertyId,
  value: unknown,
  code: "invalid_registry" | "invalid_selection" = "invalid_registry",
): DataSourceOptionId => {
  try {
    return parseDataSourceOptionId({ propertyId, value });
  } catch (error) {
    return fail(
      code,
      `Option identity is invalid for Property ${propertyId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    );
  }
};

const parseStoredOptionName = (
  propertyId: DataSourcePropertyId,
  value: unknown,
  label: string,
): string => {
  if (propertyId !== "tags") {
    return requireCanonicalString(
      value,
      label,
      MAX_DATA_SOURCE_OPTION_NAME_LENGTH,
    );
  }
  let canonical: string;
  try {
    canonical = canonicalizeTagName(value, {
      maxLength: MAX_DATA_SOURCE_OPTION_NAME_LENGTH,
    });
  } catch (error) {
    return fail(
      "invalid_registry",
      `${label} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  if (canonical === value) return canonical;
  return fail(
    "invalid_registry",
    `${label} must already be Unicode NFC with no surrounding whitespace`,
  );
};

const canonicalizeMutationOptionName = (
  propertyId: DataSourcePropertyId,
  value: unknown,
): string => {
  if (propertyId !== "tags") {
    return requireCanonicalString(
      value,
      "option.name",
      MAX_DATA_SOURCE_OPTION_NAME_LENGTH,
    );
  }
  try {
    return canonicalizeTagName(value, {
      maxLength: MAX_DATA_SOURCE_OPTION_NAME_LENGTH,
    });
  } catch (error) {
    return fail(
      "invalid_registry",
      `option.name is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    );
  }
};

const parseOption = (
  propertyId: DataSourcePropertyId,
  value: unknown,
  index: number,
): DataSourceOptionRegistryEntry => {
  const label = `optionRegistry.config.options[${index}]`;
  const option = requireRecord(value, label);
  requireExactKeys(option, label, ["id", "name"], ["color"]);
  return {
    optionId: parseOptionId(propertyId, option.id),
    name: parseStoredOptionName(propertyId, option.name, `${label}.name`),
    ...(option.color === undefined
      ? {}
      : {
          color: requireCanonicalString(
            option.color,
            `${label}.color`,
            MAX_DATA_SOURCE_OPTION_COLOR_LENGTH,
          ),
        }),
  };
};

const assertUniqueRegistryEntries = (
  propertyId: DataSourcePropertyId,
  options: readonly DataSourceOptionRegistryEntry[],
): void => {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const option of options) {
    if (seenIds.has(option.optionId)) {
      fail(
        "invalid_registry",
        `Option registry repeats identity ${option.optionId}`,
      );
    }
    seenIds.add(option.optionId);
    if (propertyId !== "tags") continue;
    if (seenNames.has(option.name)) {
      fail(
        "option_name_conflict",
        `The tags Property repeats canonical option name ${JSON.stringify(option.name)}`,
      );
    }
    seenNames.add(option.name);
  }
};

export const parseDataSourceOptionRegistry = (
  input: ParseDataSourceOptionRegistryInput,
): DataSourceOptionRegistry => {
  const { dataSourceId, propertyId } = parseRegistryCoordinates(input);
  const valueType = parseRegistryValueType(input.valueType);
  validatePropertyRole(propertyId, valueType);
  const config = requireRecord(input.config, "optionRegistry.config");
  requireExactKeys(config, "optionRegistry.config", ["options"]);
  if (!Array.isArray(config.options)) {
    return fail(
      "invalid_registry",
      "optionRegistry.config.options must be an array",
    );
  }
  if (config.options.length > MAX_DATA_SOURCE_PROPERTY_OPTIONS) {
    return fail(
      "invalid_registry",
      `Option registry cannot exceed ${MAX_DATA_SOURCE_PROPERTY_OPTIONS} options`,
    );
  }
  const options = config.options.map((option, index) =>
    parseOption(propertyId, option, index),
  );
  assertUniqueRegistryEntries(propertyId, options);
  return { dataSourceId, propertyId, valueType, options };
};

export const dataSourceOptionRegistryConfig = (
  registry: DataSourceOptionRegistry,
): Readonly<{
  readonly options: readonly Readonly<{
    readonly id: DataSourceOptionId;
    readonly name: string;
    readonly color?: string;
  }>[];
}> => ({
  options: registry.options.map((option) => ({
    id: option.optionId,
    name: option.name,
    ...(option.color === undefined ? {} : { color: option.color }),
  })),
});

export const resolveTagOptionByCanonicalName = (
  registry: DataSourceOptionRegistry,
  value: unknown,
): DataSourceOptionRegistryEntry | null => {
  if (registry.propertyId !== "tags" || registry.valueType !== "multi_select") {
    return fail(
      "invalid_registry",
      "Canonical tag resolution requires the reserved tags registry",
    );
  }
  let name: string;
  try {
    name = canonicalizeTagName(value, {
      maxLength: MAX_DATA_SOURCE_OPTION_NAME_LENGTH,
    });
  } catch (error) {
    return fail(
      "invalid_registry",
      `Tag name is invalid: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  return registry.options.find((option) => option.name === name) ?? null;
};

export const putDataSourceOption = (
  registry: DataSourceOptionRegistry,
  input: PutDataSourceOptionInput,
): DataSourceOptionRegistry => {
  const optionId = parseOptionId(registry.propertyId, input.optionId);
  const name = canonicalizeMutationOptionName(registry.propertyId, input.name);
  const color = input.color === undefined
    ? undefined
    : requireCanonicalString(
        input.color,
        "option.color",
        MAX_DATA_SOURCE_OPTION_COLOR_LENGTH,
      );
  const existingIndex = registry.options.findIndex(
    (option) => option.optionId === optionId,
  );
  if (
    registry.propertyId === "tags" &&
    registry.options.some(
      (option) => option.optionId !== optionId && option.name === name,
    )
  ) {
    return fail(
      "option_name_conflict",
      `The tags Property already defines canonical option name ${JSON.stringify(name)}`,
    );
  }
  const nextOption: DataSourceOptionRegistryEntry = {
    optionId,
    name,
    ...(color === undefined ? {} : { color }),
  };
  if (existingIndex < 0) {
    if (registry.options.length >= MAX_DATA_SOURCE_PROPERTY_OPTIONS) {
      return fail(
        "invalid_registry",
        `Option registry cannot exceed ${MAX_DATA_SOURCE_PROPERTY_OPTIONS} options`,
      );
    }
    return { ...registry, options: [...registry.options, nextOption] };
  }
  const existing = registry.options[existingIndex];
  if (
    existing?.name === nextOption.name &&
    existing.color === nextOption.color
  ) {
    return registry;
  }
  return {
    ...registry,
    options: registry.options.map((option, index) =>
      index === existingIndex ? nextOption : option,
    ),
  };
};

export const validateDataSourceOptionSelection = (
  registry: DataSourceOptionRegistry,
  value: unknown,
): DataSourceOptionSelection => {
  if (value === null) return null;
  const knownIds = new Set(
    registry.options.map((option) => option.optionId),
  );
  if (registry.valueType === "select") {
    const optionId = parseOptionId(
      registry.propertyId,
      value,
      "invalid_selection",
    );
    if (knownIds.has(optionId)) return optionId;
    return fail(
      "invalid_selection",
      `Property ${registry.propertyId} does not define option ${optionId}`,
    );
  }
  if (!Array.isArray(value)) {
    return fail(
      "invalid_selection",
      `Property ${registry.propertyId} requires an array of option IDs or null`,
    );
  }
  const normalized = [...new Set(
    value.map((candidate) =>
      parseOptionId(
        registry.propertyId,
        candidate,
        "invalid_selection",
      ),
    ),
  )].sort(compareStrings);
  const unknown = normalized.find((optionId) => !knownIds.has(optionId));
  if (!unknown) return normalized;
  return fail(
    "invalid_selection",
    `Property ${registry.propertyId} does not define option ${unknown}`,
  );
};

const selectionContains = (
  selection: DataSourceOptionSelection,
  optionId: DataSourceOptionId,
): boolean => {
  if (selection === null) return false;
  if (typeof selection === "string") return selection === optionId;
  return selection.includes(optionId);
};

export const deleteDataSourceOption = (
  registry: DataSourceOptionRegistry,
  input: DeleteDataSourceOptionInput,
): DataSourceOptionRegistry => {
  const optionId = parseOptionId(registry.propertyId, input.optionId);
  const exists = registry.options.some(
    (option) => option.optionId === optionId,
  );
  if (!exists) {
    return fail(
      "option_not_found",
      `Property ${registry.propertyId} does not define option ${optionId}`,
    );
  }
  const selected = input.selectedValues.some((value) =>
    selectionContains(
      validateDataSourceOptionSelection(registry, value),
      optionId,
    ),
  );
  if (selected) {
    return fail(
      "option_in_use",
      `Property ${registry.propertyId} option ${optionId} is still selected`,
    );
  }
  return {
    ...registry,
    options: registry.options.filter((option) => option.optionId !== optionId),
  };
};
