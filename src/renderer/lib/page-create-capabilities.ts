import { matchBuiltInDataSourceProperty } from "../../shared/data-source-built-ins";
import type { DataSourcePropertyRecordV2 } from "../../shared/database-module-v2";
import type { PageCreateInput } from "./types";

export interface PageCreatePropertyCapabilities {
  readonly priorityProperty: DataSourcePropertyRecordV2 | null;
  readonly estimateProperty: DataSourcePropertyRecordV2 | null;
  readonly tagsProperty: DataSourcePropertyRecordV2 | null;
}

export function resolvePageCreatePropertyCapabilities(
  properties: readonly DataSourcePropertyRecordV2[],
): PageCreatePropertyCapabilities {
  const capabilities: PageCreatePropertyCapabilities = {
    priorityProperty: null,
    estimateProperty: null,
    tagsProperty: null,
  };

  return properties.reduce<PageCreatePropertyCapabilities>((current, property) => {
    const role = matchBuiltInDataSourceProperty(property);
    if (role === "priority" && !current.priorityProperty) {
      return { ...current, priorityProperty: property };
    }
    if (role === "estimate" && !current.estimateProperty) {
      return { ...current, estimateProperty: property };
    }
    if (role === "tags" && !current.tagsProperty) {
      return { ...current, tagsProperty: property };
    }
    return current;
  }, capabilities);
}

export function gatePageCreateInputByCapabilities(
  input: PageCreateInput,
  capabilities: PageCreatePropertyCapabilities,
): PageCreateInput {
  return {
    ...input,
    priority: capabilities.priorityProperty ? input.priority : undefined,
    estimate: capabilities.estimateProperty ? input.estimate : undefined,
    tags: capabilities.tagsProperty ? input.tags : [],
  };
}
