import type Database from "better-sqlite3";

import {
  compilePageLifecycleCreateRequestV2,
  type PageLifecycleCreateDisplayIntent,
  type PageLifecycleCreateMutationRequestV2,
} from "../../shared/page-lifecycle-v2-runtime";

interface TagsPropertyRow {
  readonly data_source_id: string;
  readonly id: string;
  readonly value_type: string;
  readonly lifecycle: string;
  readonly schema_revision: number;
  readonly config_json: string;
}

/**
 * Resolve display-name Page creation intent against the Project's persisted
 * default Data Source, then freeze all tag option identities into a retry-safe
 * v2 authority request before any write begins.
 */
export const compilePageLifecycleCreateRequestV2InDatabase = (
  database: Database.Database,
  request: PageLifecycleCreateDisplayIntent,
): PageLifecycleCreateMutationRequestV2 => {
  const property = database.prepare(`
    SELECT
      property.data_source_id,
      property.id,
      property.value_type,
      property.lifecycle,
      property.schema_revision,
      property.config_json
    FROM project_database_bindings binding
    INNER JOIN data_sources source
      ON source.home_database_block_id = binding.database_block_id
     AND source.library_id = binding.library_id
     AND source.lifecycle = 'active'
    INNER JOIN data_source_properties property
      ON property.data_source_id = source.id
     AND property.id = 'tags'
     AND property.lifecycle = 'active'
    WHERE binding.project_id = ? AND binding.lifecycle = 'active'
    ORDER BY source.rank_key, source.id
    LIMIT 1
  `).get(request.projectId) as TagsPropertyRow | undefined;
  if (!property) {
    throw new Error(
      `Project ${request.projectId} has no active default Data Source tags Property`,
    );
  }
  let config: Readonly<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(property.config_json) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("config must be a JSON object");
    }
    config = parsed as Readonly<Record<string, unknown>>;
  } catch (error) {
    throw new Error(
      `Data Source ${property.data_source_id} tags Property has invalid config`,
      { cause: error },
    );
  }
  return compilePageLifecycleCreateRequestV2({
    request,
    tagsProperty: {
      propertyId: property.id,
      dataSourceId: property.data_source_id,
      valueType: property.value_type,
      lifecycle: property.lifecycle,
      revision: property.schema_revision,
      config,
    },
  });
};
