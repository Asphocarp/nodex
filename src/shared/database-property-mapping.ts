import {
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
} from "./database-kernel";

export interface DatabasePropertyMappingDefinition {
  readonly valueType: DatabasePropertyValueType;
  readonly config: Readonly<Record<string, DatabaseJsonValue>>;
}

export type DatabasePropertyMappingResult =
  | { readonly compatible: true; readonly value: DatabaseJsonValue }
  | { readonly compatible: false };

interface SelectOption {
  readonly id: string;
  readonly name: string;
}

const normalizedOptionName = (value: string): string =>
  value.normalize("NFKC").trim().toLocaleLowerCase("en-US");

const readOptions = (
  definition: DatabasePropertyMappingDefinition,
): readonly SelectOption[] => {
  const config = parseDatabasePropertyConfig(
    definition.valueType,
    definition.config,
  );
  if (!Array.isArray(config.options)) return [];
  return config.options.flatMap((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string"
    ) {
      return [];
    }
    return [{ id: candidate.id, name: candidate.name }];
  });
};

const mapOptionId = (
  sourceId: string,
  sourceOptions: readonly SelectOption[],
  targetOptions: readonly SelectOption[],
): string | null => {
  if (targetOptions.some((option) => option.id === sourceId)) return sourceId;
  const source = sourceOptions.find((option) => option.id === sourceId);
  if (!source) return null;
  const sourceName = normalizedOptionName(source.name);
  const matches = targetOptions.filter(
    (option) => normalizedOptionName(option.name) === sourceName,
  );
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
};

export const mapCompatibleDatabasePropertyValue = (input: {
  readonly source: DatabasePropertyMappingDefinition;
  readonly target: DatabasePropertyMappingDefinition;
  readonly value: unknown;
}): DatabasePropertyMappingResult => {
  if (input.source.valueType !== input.target.valueType) {
    return { compatible: false };
  }
  if (input.value === null) return { compatible: true, value: null };

  try {
    if (input.target.valueType === "select") {
      if (typeof input.value !== "string") return { compatible: false };
      const mapped = mapOptionId(
        input.value,
        readOptions(input.source),
        readOptions(input.target),
      );
      return mapped === null
        ? { compatible: false }
        : { compatible: true, value: mapped };
    }

    if (input.target.valueType === "multi_select") {
      if (
        !Array.isArray(input.value) ||
        !input.value.every((entry) => typeof entry === "string")
      ) {
        return { compatible: false };
      }
      const sourceOptions = readOptions(input.source);
      const targetOptions = readOptions(input.target);
      const mapped = input.value.map((sourceId) =>
        mapOptionId(sourceId, sourceOptions, targetOptions),
      );
      if (mapped.some((targetId) => targetId === null)) {
        return { compatible: false };
      }
      return {
        compatible: true,
        value: [...new Set(mapped as string[])].sort((left, right) =>
          left.localeCompare(right),
        ),
      };
    }

    return {
      compatible: true,
      value: normalizeDatabasePropertyValue(input.target, input.value),
    };
  } catch {
    return { compatible: false };
  }
};
