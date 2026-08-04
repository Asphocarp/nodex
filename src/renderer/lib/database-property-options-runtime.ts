import type { DatabasePropertyOption } from "../../shared/database-kernel";
import type {
  DataSourcePropertyRecordV2,
  DatabaseModuleReadResultV2,
} from "../../shared/database-module-v2";
import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../../shared/database-module-v2";
import type { DatabaseViewAccessContext } from "./database-view-render-model";
import { readDatabaseModule, readLibraryDatabaseModule } from "./api";

const assertOptionWindow = (
  result: DatabaseModuleReadResultV2 | Awaited<ReturnType<typeof readLibraryDatabaseModule>>,
): readonly DatabasePropertyOption[] => {
  if (!result.ok) throw new Error(result.error.message);
  if (result.value.value.kind !== "option_window") {
    throw new Error("Database returned a non-option Property window");
  }
  if (result.value.value.value.nextCursor !== null) {
    throw new Error("Property option registry exceeded its bounded read");
  }
  return result.value.value.value.options;
};

export const readPropertyOptionRegistry = async (
  accessContext: DatabaseViewAccessContext,
  property: DataSourcePropertyRecordV2,
): Promise<readonly DatabasePropertyOption[]> => {
  if (property.valueType !== "select" && property.valueType !== "multi_select") {
    return [];
  }
  const read = {
    target: {
      kind: "property" as const,
      dataSourceId: property.dataSourceId,
      propertyId: property.propertyId,
    },
    mode: "option_window" as const,
    window: { first: 100 },
  };
  if (accessContext.kind === "library") {
    return assertOptionWindow(await readLibraryDatabaseModule({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      read,
    }));
  }
  return assertOptionWindow(await readDatabaseModule(accessContext.projectId, {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    projectId: accessContext.projectId,
    read,
  }));
};

export const withPropertyOptions = (
  property: DataSourcePropertyRecordV2,
  options: readonly DatabasePropertyOption[],
): DataSourcePropertyRecordV2 => ({
  ...property,
  config: {
    options: options.map((option) => ({
      id: option.id,
      name: option.name,
      ...(option.color === undefined ? {} : { color: option.color }),
    })),
  },
});
