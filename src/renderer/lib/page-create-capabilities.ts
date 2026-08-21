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
  let priorityProperty: DataSourcePropertyRecordV2 | null = null;
  let estimateProperty: DataSourcePropertyRecordV2 | null = null;
  let tagsProperty: DataSourcePropertyRecordV2 | null = null;
  for (const property of properties) {
    const role = matchBuiltInDataSourceProperty(property);
    if (role === "priority" && !priorityProperty) priorityProperty = property;
    if (role === "estimate" && !estimateProperty) estimateProperty = property;
    if (role === "tags" && !tagsProperty) tagsProperty = property;
    if (priorityProperty && estimateProperty && tagsProperty) break;
  }
  return { priorityProperty, estimateProperty, tagsProperty };
}

export function gatePageCreateInputByCapabilities(
  input: PageCreateInput,
  capabilities: PageCreatePropertyCapabilities,
): PageCreateInput {
  return {
    ...input,
    priority: capabilities.priorityProperty ? input.priority : undefined,
    estimate: capabilities.estimateProperty ? input.estimate : undefined,
    tagOptions: capabilities.tagsProperty ? input.tagOptions : [],
  };
}
