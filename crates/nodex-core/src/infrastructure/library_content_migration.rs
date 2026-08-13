//! Store-v117 cutover from Project-owned physical content to Library ownership.
//!
//! The migration deliberately rebuilds the narrow set of tables whose foreign
//! keys encoded Project as a content owner. Project-scoped receipts and delivery
//! records are left alone because their Project coordinate describes the actor
//! or delivery context, not the lifetime of the content row.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use crate::domain::fractional_rank::{RankedItem, plan as plan_fractional_rank};

use super::sqlite::{StoreError, StoreErrorCode};

const V117_TABLES_SQL: &str = r#"
CREATE TABLE blocks_v117 (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'active',
  placement_revision INTEGER NOT NULL DEFAULT 1 CHECK (placement_revision >= 1),
  metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK (metadata_revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, library_id),
  CHECK (lifecycle IN ('active', 'archived', 'deleted'))
) STRICT;

CREATE TABLE documents_v117 (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  head_seq INTEGER NOT NULL DEFAULT 0 CHECK (head_seq >= 0),
  schema_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  state_vector BLOB NOT NULL DEFAULT X'',
  state_hash TEXT NOT NULL DEFAULT '',
  readiness TEXT NOT NULL DEFAULT 'pending_genesis',
  authority TEXT NOT NULL DEFAULT 'legacy_shadow',
  genesis_source_revision INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_engine TEXT NOT NULL DEFAULT 'yjs' CHECK (sync_engine IN ('yjs', 'canvas_scene')),
  UNIQUE (id, library_id),
  CHECK (readiness IN ('pending_genesis', 'ready', 'failed')),
  CHECK (authority IN ('legacy_shadow', 'ydoc_primary')),
  CHECK (authority <> 'ydoc_primary' OR readiness = 'ready')
) STRICT;

CREATE TABLE pages_v117 (
  block_id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  document_id TEXT NOT NULL UNIQUE,
  parent_kind TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (block_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (document_id, library_id)
    REFERENCES documents(id, library_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (parent_kind IN ('library', 'page', 'data_source')),
  CHECK (length(trim(parent_id)) BETWEEN 1 AND 512),
  CHECK (parent_kind <> 'library' OR parent_id = library_id),
  CHECK (parent_kind <> 'page' OR parent_id <> block_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE block_properties_v117 (
  block_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  property_key TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (block_id, property_key),
  FOREIGN KEY (block_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (length(property_key) BETWEEN 1 AND 128),
  CHECK (value_type IN ('null', 'boolean', 'number', 'string', 'json')),
  CHECK (
    CASE
      WHEN json_valid(value_json) = 0 THEN 0
      WHEN json_type(value_json) = 'null' THEN value_type IN ('null', 'string', 'json')
      WHEN value_type = 'boolean' THEN json_type(value_json) IN ('true', 'false')
      WHEN value_type = 'number' THEN json_type(value_json) IN ('integer', 'real')
      WHEN value_type = 'string' THEN json_type(value_json) = 'text'
      WHEN value_type = 'json' THEN json_type(value_json) IN ('array', 'object')
      ELSE 0
    END
  )
) WITHOUT ROWID, STRICT;

CREATE TABLE block_documents_v117 (
  block_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL UNIQUE,
  library_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (block_id, library_id)
    REFERENCES blocks(id, library_id) ON DELETE RESTRICT,
  FOREIGN KEY (document_id, library_id)
    REFERENCES documents(id, library_id) ON DELETE RESTRICT
) WITHOUT ROWID, STRICT;

CREATE UNIQUE INDEX idx_block_documents_owner_document_library_v117
  ON block_documents_v117(block_id, document_id, library_id);

CREATE TABLE block_asset_refs_v117 (
  document_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  owner_block_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  document_generation INTEGER NOT NULL CHECK (document_generation >= 1),
  projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
  projection_version INTEGER NOT NULL DEFAULT 1 CHECK (projection_version >= 1),
  role TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  asset_uri TEXT NOT NULL,
  asset_hash TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (document_id, block_id, role, ordinal),
  FOREIGN KEY (document_id, library_id)
    REFERENCES documents(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (block_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (owner_block_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (length(role) BETWEEN 1 AND 128),
  CHECK (length(asset_uri) BETWEEN 1 AND 4096),
  CHECK (
    asset_hash IS NULL OR (
      length(asset_hash) = 64 AND asset_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (length(updated_at) > 0)
) WITHOUT ROWID, STRICT;

CREATE TABLE block_search_units_v117 (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_key TEXT NOT NULL UNIQUE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  owner_block_id TEXT NOT NULL,
  document_id TEXT,
  document_generation INTEGER,
  projected_seq INTEGER,
  source_revision INTEGER,
  projection_version INTEGER NOT NULL DEFAULT 1 CHECK (projection_version >= 1),
  source_kind TEXT NOT NULL,
  field_key TEXT NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (block_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (owner_block_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (document_id, library_id)
    REFERENCES documents(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  UNIQUE (block_id, source_kind, field_key),
  CHECK (length(unit_key) BETWEEN 1 AND 1024),
  CHECK (length(source_kind) BETWEEN 1 AND 128),
  CHECK (length(field_key) BETWEEN 1 AND 256),
  CHECK (length(text_hash) = 64 AND text_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(updated_at) > 0),
  CHECK (
    (document_id IS NOT NULL
      AND document_generation >= 1
      AND projected_seq >= 0
      AND source_revision IS NULL)
    OR (document_id IS NULL
      AND document_generation IS NULL
      AND projected_seq IS NULL
      AND source_revision >= 1
      AND owner_block_id = block_id)
  )
) STRICT;

CREATE TABLE canvas_page_references_v117 (
  document_id TEXT NOT NULL,
  source_element_id TEXT NOT NULL,
  target_block_id TEXT NOT NULL,
  owner_block_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  document_generation INTEGER NOT NULL CHECK (document_generation >= 1),
  projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
  title_hint TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (document_id, source_element_id),
  FOREIGN KEY (target_block_id) REFERENCES blocks(id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_block_id, document_id, library_id)
    REFERENCES block_documents(block_id, document_id, library_id) ON DELETE CASCADE,
  FOREIGN KEY (document_id, library_id)
    REFERENCES documents(id, library_id) ON DELETE CASCADE,
  CHECK (length(source_element_id) BETWEEN 1 AND 512),
  CHECK (title_hint IS NULL OR length(title_hint) <= 512)
) WITHOUT ROWID, STRICT;

CREATE TABLE canvas_scene_file_refs_v117 (
  document_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  owner_block_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  document_generation INTEGER NOT NULL CHECK (document_generation >= 1),
  projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
  mime_type TEXT NOT NULL,
  asset_uri TEXT NOT NULL,
  managed_file_name TEXT NOT NULL,
  asset_hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (document_id, file_id),
  FOREIGN KEY (owner_block_id, document_id, library_id)
    REFERENCES block_documents(block_id, document_id, library_id) ON DELETE CASCADE,
  FOREIGN KEY (document_id, library_id)
    REFERENCES documents(id, library_id) ON DELETE CASCADE,
  CHECK (length(file_id) BETWEEN 1 AND 512),
  CHECK (length(mime_type) BETWEEN 1 AND 256),
  CHECK (length(asset_uri) BETWEEN 1 AND 4096),
  CHECK (length(managed_file_name) BETWEEN 1 AND 512),
  CHECK (length(asset_hash) = 64 AND asset_hash NOT GLOB '*[^0-9a-f]*')
) WITHOUT ROWID, STRICT;

CREATE TABLE page_read_model_v117 (
  page_block_id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  parent_kind TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  library_rank_key TEXT,
  placement_revision INTEGER NOT NULL CHECK (placement_revision >= 1),
  metadata_revision INTEGER NOT NULL CHECK (metadata_revision >= 1),
  document_id TEXT NOT NULL UNIQUE,
  document_generation INTEGER NOT NULL CHECK (document_generation >= 1),
  document_projected_seq INTEGER NOT NULL CHECK (document_projected_seq >= 0),
  document_schema_version INTEGER NOT NULL CHECK (document_schema_version >= 1),
  document_authority TEXT NOT NULL,
  membership_id TEXT,
  database_block_id TEXT,
  view_id TEXT,
  view_group_key TEXT,
  view_rank_key TEXT,
  title TEXT NOT NULL,
  description_preview TEXT NOT NULL,
  description_length INTEGER NOT NULL CHECK (description_length >= 0),
  has_description INTEGER NOT NULL CHECK (has_description IN (0, 1)),
  database_values_json TEXT NOT NULL DEFAULT '{}',
  intrinsic_properties_json TEXT NOT NULL DEFAULT '{}',
  property_revisions_json TEXT NOT NULL DEFAULT '{}',
  projection_version INTEGER NOT NULL DEFAULT 1 CHECK (projection_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (page_block_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (document_id, library_id)
    REFERENCES documents(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (membership_id)
    REFERENCES data_source_page_memberships(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (database_block_id)
    REFERENCES database_containers(block_id) ON DELETE RESTRICT,
  FOREIGN KEY (view_id)
    REFERENCES database_views(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (lifecycle IN ('active', 'archived', 'deleted')),
  CHECK (parent_kind IN ('library', 'page', 'data_source')),
  CHECK (
    (parent_kind = 'library' AND lifecycle <> 'deleted' AND library_rank_key IS NOT NULL)
    OR ((parent_kind <> 'library' OR lifecycle = 'deleted') AND library_rank_key IS NULL)
  ),
  CHECK (document_authority IN ('legacy_shadow', 'ydoc_primary')),
  CHECK (
    (membership_id IS NULL AND database_block_id IS NULL)
    OR (membership_id IS NOT NULL AND database_block_id IS NOT NULL)
  ),
  CHECK (view_id IS NULL OR membership_id IS NOT NULL),
  CHECK (json_valid(database_values_json) AND json_type(database_values_json) = 'object'),
  CHECK (json_valid(intrinsic_properties_json) AND json_type(intrinsic_properties_json) = 'object'),
  CHECK (json_valid(property_revisions_json) AND json_type(property_revisions_json) = 'object'),
  CHECK (length(created_at) > 0 AND length(updated_at) > 0)
) WITHOUT ROWID, STRICT;

CREATE TABLE recurrence_exceptions_v117 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  occurrence_start TEXT NOT NULL,
  exception_type TEXT NOT NULL,
  override_start TEXT,
  override_end TEXT,
  override_reminders_json TEXT,
  created TEXT NOT NULL,
  FOREIGN KEY (page_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (exception_type IN ('skip', 'override_time'))
) STRICT;

CREATE TABLE reminder_receipts_v117 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
  page_id TEXT NOT NULL,
  occurrence_start TEXT NOT NULL,
  reminder_offset_minutes INTEGER NOT NULL,
  delivered_at TEXT NOT NULL,
  FOREIGN KEY (page_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE TABLE reminder_snoozes_v117 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
  page_id TEXT NOT NULL,
  occurrence_start TEXT NOT NULL,
  due_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (page_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE
) STRICT;

CREATE TABLE scheduled_page_index_v117 (
  page_block_id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  scheduled_start TEXT,
  scheduled_end TEXT,
  is_all_day INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
  recurrence_json TEXT NOT NULL DEFAULT 'null',
  reminders_json TEXT NOT NULL DEFAULT '[]',
  schedule_timezone TEXT,
  source_metadata_revision INTEGER NOT NULL CHECK (source_metadata_revision >= 1),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (page_block_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (lifecycle IN ('active', 'archived', 'deleted')),
  CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end > scheduled_start),
  CHECK (is_all_day = 0 OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL)),
  CHECK (json_valid(recurrence_json) AND json_type(recurrence_json) IN ('null', 'object')),
  CHECK (json_valid(reminders_json) AND json_type(reminders_json) = 'array')
) WITHOUT ROWID, STRICT;

CREATE TABLE core_reminder_leases_v117 (
  lease_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  receipt_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
  page_id TEXT NOT NULL,
  occurrence_start_ms INTEGER NOT NULL CHECK (occurrence_start_ms >= 0),
  reminder_offset_minutes INTEGER NOT NULL,
  due_at_ms INTEGER NOT NULL CHECK (due_at_ms >= 0),
  title TEXT NOT NULL,
  snooze_id INTEGER REFERENCES reminder_snoozes(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 4294967295),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'completed', 'failed', 'cancelled')),
  claimed_at_ms INTEGER NOT NULL CHECK (claimed_at_ms >= 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > claimed_at_ms),
  settled_at_ms INTEGER,
  retry_at_ms INTEGER,
  reason_code TEXT,
  UNIQUE (receipt_project_id, page_id, occurrence_start_ms, reminder_offset_minutes, attempt),
  FOREIGN KEY (page_id, library_id)
    REFERENCES blocks(id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (length(lease_id) BETWEEN 1 AND 512),
  CHECK (length(title) <= 16384),
  CHECK (settled_at_ms IS NULL OR settled_at_ms >= claimed_at_ms),
  CHECK (retry_at_ms IS NULL OR retry_at_ms >= 0),
  CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 128),
  CHECK (
    (status = 'claimed' AND settled_at_ms IS NULL)
    OR (status <> 'claimed' AND settled_at_ms IS NOT NULL)
  )
) WITHOUT ROWID, STRICT;

CREATE TABLE retired_block_identities_v117 (
  block_id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
  block_type TEXT NOT NULL,
  retention_root_block_id TEXT NOT NULL,
  retired_at TEXT NOT NULL,
  CHECK (length(block_id) BETWEEN 1 AND 512 AND block_id = trim(block_id)),
  CHECK (length(library_id) BETWEEN 1 AND 512 AND library_id = trim(library_id)),
  CHECK (length(block_type) BETWEEN 1 AND 512 AND block_type = trim(block_type)),
  CHECK (
    length(retention_root_block_id) BETWEEN 1 AND 512
    AND retention_root_block_id = trim(retention_root_block_id)
  ),
  CHECK (length(retired_at) > 0)
) WITHOUT ROWID, STRICT;

CREATE TABLE block_relocations_v117 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
  store_epoch TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  source_base_head_seq INTEGER NOT NULL CHECK (source_base_head_seq >= 0),
  target_kind TEXT NOT NULL,
  target_document_id TEXT,
  target_generation INTEGER,
  target_base_head_seq INTEGER,
  target_parent_block_id TEXT,
  target_before_block_id TEXT,
  root_block_ids_json TEXT NOT NULL,
  expected_placement_revisions_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'committed',
  source_update_id TEXT NOT NULL,
  source_committed_seq INTEGER NOT NULL CHECK (source_committed_seq >= 1),
  target_update_id TEXT,
  target_committed_seq INTEGER,
  final_placement_revisions_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  change_log_seq INTEGER NOT NULL UNIQUE
    REFERENCES change_log(seq) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  committed_at TEXT NOT NULL,
  UNIQUE (id, project_id),
  UNIQUE (id, library_id),
  UNIQUE (
    id, source_document_id, project_id, source_generation, source_base_head_seq
  ),
  UNIQUE (
    id, source_document_id, library_id, source_generation, source_base_head_seq
  ),
  FOREIGN KEY (source_document_id) REFERENCES documents(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_document_id) REFERENCES documents(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_parent_block_id) REFERENCES blocks(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_before_block_id) REFERENCES blocks(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_document_id, source_generation, source_committed_seq)
    REFERENCES document_update_receipts(document_id, generation, seq) ON DELETE RESTRICT,
  FOREIGN KEY (target_document_id, target_generation, target_committed_seq)
    REFERENCES document_update_receipts(document_id, generation, seq) ON DELETE RESTRICT,
  CHECK (length(id) BETWEEN 1 AND 512),
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
  CHECK (
    json_valid(root_block_ids_json)
    AND json_type(root_block_ids_json) = 'array'
    AND json_array_length(root_block_ids_json) > 0
  ),
  CHECK (
    json_valid(expected_placement_revisions_json)
    AND json_type(expected_placement_revisions_json) = 'object'
  ),
  CHECK (
    json_valid(final_placement_revisions_json)
    AND json_type(final_placement_revisions_json) = 'object'
  ),
  CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
  CHECK (status = 'committed'),
  CHECK (target_kind IN ('document', 'library')),
  CHECK (
    (target_kind = 'document'
      AND target_document_id IS NOT NULL
      AND target_document_id <> source_document_id
      AND target_generation IS NOT NULL
      AND target_generation >= 1
      AND target_base_head_seq IS NOT NULL
      AND target_base_head_seq >= 0
      AND target_update_id IS NOT NULL
      AND target_committed_seq = target_base_head_seq + 1)
    OR (target_kind = 'library'
      AND target_document_id IS NULL
      AND target_generation IS NULL
      AND target_base_head_seq IS NULL
      AND target_parent_block_id IS NULL
      AND target_update_id IS NULL
      AND target_committed_seq IS NULL)
  ),
  CHECK (source_committed_seq = source_base_head_seq + 1),
  CHECK (source_update_id = 'relocation:' || request_hash || ':source'),
  CHECK (
    target_update_id IS NULL
    OR target_update_id = 'relocation:' || request_hash || ':target'
  ),
  CHECK (length(committed_at) > 0)
) STRICT;

CREATE TABLE block_relocation_members_v117 (
  relocation_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  tree_ordinal INTEGER NOT NULL CHECK (tree_ordinal >= 0),
  is_root INTEGER NOT NULL CHECK (is_root IN (0, 1)),
  source_placement_revision INTEGER NOT NULL CHECK (source_placement_revision >= 1),
  final_placement_revision INTEGER NOT NULL CHECK (final_placement_revision >= 2),
  PRIMARY KEY (relocation_id, block_id),
  UNIQUE (relocation_id, tree_ordinal),
  FOREIGN KEY (relocation_id, library_id)
    REFERENCES block_relocations(id, library_id) ON DELETE CASCADE,
  FOREIGN KEY (block_id, library_id)
    REFERENCES blocks(id, library_id) ON DELETE RESTRICT,
  CHECK (final_placement_revision = source_placement_revision + 1)
) WITHOUT ROWID, STRICT;
"#;

const V117_COPY_SQL: &str = r#"
INSERT INTO blocks_v117(
  id, library_id, type, lifecycle, placement_revision, metadata_revision,
  created_at, updated_at
)
SELECT block.id, project.library_id, block.type, block.lifecycle,
       block.location_revision, block.metadata_revision, block.created_at, block.updated_at
FROM blocks block
JOIN projects project ON project.id = block.project_id;

INSERT INTO documents_v117(
  id, library_id, generation, head_seq, schema_key, schema_version, state_vector,
  state_hash, readiness, authority, genesis_source_revision, created_at, updated_at,
  sync_engine
)
SELECT document.id, project.library_id, document.generation, document.head_seq,
       document.schema_key, document.schema_version, document.state_vector,
       document.state_hash, document.readiness, document.authority,
       document.genesis_source_revision, document.created_at, document.updated_at,
       document.sync_engine
FROM documents document
JOIN projects project ON project.id = document.project_id;

INSERT INTO pages_v117(
  block_id, library_id, document_id, parent_kind, parent_id, created_at, updated_at
)
SELECT page.block_id, page.library_id, page.document_id, page.parent_kind,
       page.parent_id, page.created_at, page.updated_at
FROM pages page;

INSERT INTO block_properties_v117
SELECT property.block_id, project.library_id, property.property_key, property.value_type,
       property.value_json, property.revision, property.updated_at
FROM block_properties property
JOIN projects project ON project.id = property.project_id;

INSERT INTO block_documents_v117
SELECT ownership.block_id, ownership.document_id, project.library_id, ownership.created_at
FROM block_documents ownership
JOIN projects project ON project.id = ownership.project_id;

INSERT INTO block_asset_refs_v117
SELECT reference.document_id, reference.block_id, reference.owner_block_id,
       project.library_id, reference.document_generation, reference.projected_seq,
       reference.projection_version, reference.role, reference.ordinal,
       reference.asset_uri, reference.asset_hash, reference.updated_at
FROM block_asset_refs reference
JOIN projects project ON project.id = reference.project_id;

INSERT INTO block_search_units_v117
SELECT unit.rowid, unit.unit_key, project.library_id, unit.block_id, unit.owner_block_id,
       unit.document_id, unit.document_generation, unit.projected_seq,
       unit.source_revision, unit.projection_version, unit.source_kind, unit.field_key,
       unit.text, unit.text_hash, unit.updated_at
FROM block_search_units unit
JOIN projects project ON project.id = unit.project_id;

INSERT INTO canvas_page_references_v117
SELECT reference.document_id, reference.source_element_id, reference.target_block_id,
       reference.owner_block_id, project.library_id, reference.document_generation,
       reference.projected_seq, reference.title_hint, reference.updated_at
FROM canvas_page_references reference
JOIN projects project ON project.id = reference.project_id;

INSERT INTO canvas_scene_file_refs_v117
SELECT reference.document_id, reference.file_id, reference.owner_block_id,
       project.library_id, reference.document_generation, reference.projected_seq,
       reference.mime_type, reference.asset_uri, reference.managed_file_name,
       reference.asset_hash, reference.byte_length, reference.updated_at
FROM canvas_scene_file_refs reference
JOIN projects project ON project.id = reference.project_id;

INSERT INTO page_read_model_v117(
  page_block_id, library_id, lifecycle, parent_kind, parent_id, library_rank_key,
  placement_revision, metadata_revision, document_id, document_generation,
  document_projected_seq, document_schema_version, document_authority, membership_id,
  database_block_id, view_id, view_group_key, view_rank_key, title,
  description_preview, description_length, has_description, database_values_json,
  intrinsic_properties_json, property_revisions_json, projection_version,
  created_at, updated_at
)
SELECT projection.page_block_id, page.library_id, projection.lifecycle,
       page.parent_kind, page.parent_id, placement.rank_key,
       block.location_revision, block.metadata_revision,
       projection.document_id, projection.document_generation,
       projection.document_projected_seq, projection.document_schema_version,
       projection.document_authority, projection.membership_id,
       projection.database_block_id, projection.view_id, projection.view_group_key,
       projection.view_rank_key, projection.title, projection.description_preview,
       projection.description_length, projection.has_description,
       projection.database_values_json, projection.intrinsic_properties_json,
       projection.property_revisions_json, projection.projection_version,
       projection.created_at, projection.updated_at
FROM page_read_model projection
JOIN pages page ON page.block_id = projection.page_block_id
JOIN blocks block ON block.id = page.block_id
LEFT JOIN library_block_placements placement
  ON placement.block_id = projection.page_block_id
 AND page.parent_kind = 'library';

INSERT INTO recurrence_exceptions_v117
SELECT exception.id, project.library_id, exception.page_id, exception.occurrence_start,
       exception.exception_type, exception.override_start, exception.override_end,
       exception.override_reminders_json, exception.created
FROM recurrence_exceptions exception
JOIN projects project ON project.id = exception.project_id;

INSERT INTO reminder_receipts_v117
SELECT receipt.id, receipt.project_id, project.library_id, receipt.page_id,
       receipt.occurrence_start, receipt.reminder_offset_minutes, receipt.delivered_at
FROM reminder_receipts receipt
JOIN projects project ON project.id = receipt.project_id;

INSERT INTO reminder_snoozes_v117
SELECT snooze.id, snooze.project_id, project.library_id, snooze.page_id,
       snooze.occurrence_start, snooze.due_at, snooze.created_at, snooze.consumed_at
FROM reminder_snoozes snooze
JOIN projects project ON project.id = snooze.project_id;

INSERT INTO scheduled_page_index_v117
SELECT schedule.page_block_id, project.library_id, schedule.lifecycle,
       schedule.scheduled_start, schedule.scheduled_end, schedule.is_all_day,
       schedule.recurrence_json, schedule.reminders_json, schedule.schedule_timezone,
       schedule.source_metadata_revision, schedule.updated_at
FROM scheduled_page_index schedule
JOIN projects project ON project.id = schedule.project_id;

INSERT INTO core_reminder_leases_v117
SELECT lease.lease_id, lease.project_id, lease.receipt_project_id,
       project.library_id, lease.page_id, lease.occurrence_start_ms,
       lease.reminder_offset_minutes, lease.due_at_ms, lease.title, lease.snooze_id,
       lease.attempt, lease.status, lease.claimed_at_ms, lease.expires_at_ms,
       lease.settled_at_ms, lease.retry_at_ms, lease.reason_code
FROM core_reminder_leases lease
JOIN projects project ON project.id = lease.receipt_project_id;

INSERT INTO retired_block_identities_v117
SELECT retired.block_id, project.library_id, retired.block_type,
       retired.retention_root_block_id, retired.retired_at
FROM retired_block_identities retired
JOIN projects project ON project.id = retired.project_id;

INSERT INTO block_relocations_v117(
  id, project_id, library_id, store_epoch, request_hash, request_json,
  source_document_id, source_generation, source_base_head_seq, target_kind,
  target_document_id, target_generation, target_base_head_seq,
  target_parent_block_id, target_before_block_id, root_block_ids_json,
  expected_placement_revisions_json, status, source_update_id,
  source_committed_seq, target_update_id, target_committed_seq,
  final_placement_revisions_json, result_json, change_log_seq, committed_at
)
SELECT relocation.id, relocation.project_id, project.library_id, relocation.store_epoch,
       relocation.request_hash, relocation.request_json, relocation.source_document_id,
       relocation.source_generation, relocation.source_base_head_seq,
       CASE relocation.target_kind WHEN 'space' THEN 'library' ELSE relocation.target_kind END,
       relocation.target_document_id, relocation.target_generation,
       relocation.target_base_head_seq, relocation.target_parent_block_id,
       relocation.target_before_block_id, relocation.root_block_ids_json,
       relocation.expected_location_revisions_json, relocation.status,
       relocation.source_update_id, relocation.source_committed_seq,
       relocation.target_update_id, relocation.target_committed_seq,
       relocation.final_location_revisions_json, relocation.result_json,
       relocation.change_log_seq, relocation.committed_at
FROM block_relocations relocation
JOIN projects project ON project.id = relocation.project_id;

INSERT INTO block_relocation_members_v117
SELECT member.relocation_id, member.block_id, project.library_id,
       member.tree_ordinal, member.is_root, member.source_location_revision,
       member.final_location_revision
FROM block_relocation_members member
JOIN projects project ON project.id = member.final_project_id;
"#;

const V117_SWAP_SQL: &str = r#"
DROP TABLE library_content_relocation_members;
DROP TABLE library_content_relocations;
DROP TABLE top_level_block_placements;

DROP TABLE block_relocation_members;
DROP TABLE core_reminder_leases;
DROP TABLE reminder_snoozes;
DROP TABLE reminder_receipts;
DROP TABLE recurrence_exceptions;
DROP TABLE scheduled_page_index;
DROP TABLE retired_block_identities;
DROP TABLE page_read_model;
DROP TABLE canvas_page_references;
DROP TABLE canvas_scene_file_refs;
DROP TABLE block_asset_refs;
DROP TABLE block_search_units;
DROP TABLE block_properties;

PRAGMA legacy_alter_table = ON;
ALTER TABLE block_relocations RENAME TO block_relocations_v116_legacy;
ALTER TABLE block_documents RENAME TO block_documents_v116_legacy;
ALTER TABLE pages RENAME TO pages_v116_legacy;
ALTER TABLE documents RENAME TO documents_v116_legacy;
ALTER TABLE blocks RENAME TO blocks_v116_legacy;
ALTER TABLE blocks_v117 RENAME TO blocks;
ALTER TABLE documents_v117 RENAME TO documents;
ALTER TABLE pages_v117 RENAME TO pages;
ALTER TABLE block_documents_v117 RENAME TO block_documents;
ALTER TABLE block_relocations_v117 RENAME TO block_relocations;
DROP TABLE documents_v116_legacy;
DROP TABLE blocks_v116_legacy;
DROP TABLE block_documents_v116_legacy;
DROP TABLE pages_v116_legacy;
DROP TABLE block_relocations_v116_legacy;
PRAGMA legacy_alter_table = OFF;

ALTER TABLE block_properties_v117 RENAME TO block_properties;
ALTER TABLE block_asset_refs_v117 RENAME TO block_asset_refs;
ALTER TABLE block_search_units_v117 RENAME TO block_search_units;
ALTER TABLE canvas_page_references_v117 RENAME TO canvas_page_references;
ALTER TABLE canvas_scene_file_refs_v117 RENAME TO canvas_scene_file_refs;
ALTER TABLE page_read_model_v117 RENAME TO page_read_model;
ALTER TABLE recurrence_exceptions_v117 RENAME TO recurrence_exceptions;
ALTER TABLE reminder_receipts_v117 RENAME TO reminder_receipts;
ALTER TABLE reminder_snoozes_v117 RENAME TO reminder_snoozes;
ALTER TABLE scheduled_page_index_v117 RENAME TO scheduled_page_index;
ALTER TABLE core_reminder_leases_v117 RENAME TO core_reminder_leases;
ALTER TABLE retired_block_identities_v117 RENAME TO retired_block_identities;
ALTER TABLE block_relocation_members_v117 RENAME TO block_relocation_members;
"#;

const V117_INDEXES_AND_TRIGGERS_SQL: &str = r#"
CREATE INDEX idx_blocks_library_lifecycle_type
  ON blocks(library_id, lifecycle, type);
CREATE INDEX idx_documents_library_readiness
  ON documents(library_id, readiness, authority);
CREATE INDEX idx_pages_library_parent
  ON pages(library_id, parent_kind, parent_id, block_id);
CREATE UNIQUE INDEX idx_pages_owner_document_library
  ON pages(block_id, document_id, library_id);
CREATE INDEX idx_block_properties_library_key
  ON block_properties(library_id, property_key, block_id);
CREATE UNIQUE INDEX idx_block_documents_owner_document_library
  ON block_documents(block_id, document_id, library_id);

CREATE INDEX idx_block_asset_refs_block ON block_asset_refs(block_id, library_id);
CREATE INDEX idx_block_asset_refs_owner ON block_asset_refs(owner_block_id, library_id);
CREATE INDEX idx_block_asset_refs_document_freshness
  ON block_asset_refs(document_id, document_generation, projected_seq);
CREATE INDEX idx_block_asset_refs_library_uri
  ON block_asset_refs(library_id, asset_uri, block_id);

CREATE INDEX idx_block_search_units_block ON block_search_units(block_id, library_id);
CREATE INDEX idx_block_search_units_owner ON block_search_units(owner_block_id, library_id);
CREATE INDEX idx_block_search_units_document_freshness
  ON block_search_units(document_id, document_generation, projected_seq)
  WHERE document_id IS NOT NULL;
CREATE INDEX idx_block_search_units_library_source
  ON block_search_units(library_id, source_kind, block_id);
CREATE TRIGGER block_search_units_ai AFTER INSERT ON block_search_units BEGIN
  INSERT INTO block_search_units_fts(rowid, text) VALUES (NEW.rowid, NEW.text);
END;
CREATE TRIGGER block_search_units_ad AFTER DELETE ON block_search_units BEGIN
  INSERT INTO block_search_units_fts(block_search_units_fts, rowid, text)
  VALUES ('delete', OLD.rowid, OLD.text);
END;
CREATE TRIGGER block_search_units_au AFTER UPDATE ON block_search_units BEGIN
  INSERT INTO block_search_units_fts(block_search_units_fts, rowid, text)
  VALUES ('delete', OLD.rowid, OLD.text);
  INSERT INTO block_search_units_fts(rowid, text) VALUES (NEW.rowid, NEW.text);
END;

CREATE INDEX idx_canvas_page_references_target
  ON canvas_page_references(library_id, target_block_id, document_id);
CREATE INDEX idx_canvas_scene_file_refs_owner
  ON canvas_scene_file_refs(library_id, owner_block_id, file_id);

CREATE INDEX idx_page_read_model_library_lifecycle
  ON page_read_model(library_id, lifecycle, page_block_id);
CREATE INDEX idx_page_read_model_parent
  ON page_read_model(library_id, parent_kind, parent_id, page_block_id);
CREATE INDEX idx_page_read_model_view_order
  ON page_read_model(view_id, view_group_key, view_rank_key, page_block_id)
  WHERE view_id IS NOT NULL;
CREATE INDEX idx_page_read_model_document_freshness
  ON page_read_model(document_id, document_generation, document_projected_seq);

CREATE INDEX idx_recurrence_exceptions_lookup
  ON recurrence_exceptions(library_id, page_id, occurrence_start);
CREATE UNIQUE INDEX idx_recurrence_exceptions_unique
  ON recurrence_exceptions(library_id, page_id, occurrence_start);
CREATE INDEX idx_reminder_receipts_lookup
  ON reminder_receipts(project_id, delivered_at DESC);
CREATE UNIQUE INDEX idx_reminder_receipts_unique
  ON reminder_receipts(project_id, page_id, occurrence_start, reminder_offset_minutes);
CREATE INDEX idx_reminder_snoozes_lookup
  ON reminder_snoozes(project_id, due_at, consumed_at);
CREATE INDEX idx_scheduled_page_index_due
  ON scheduled_page_index(library_id, scheduled_start, page_block_id)
  WHERE lifecycle = 'active' AND scheduled_start IS NOT NULL;
CREATE UNIQUE INDEX idx_core_reminder_leases_active_coordinate
  ON core_reminder_leases(
    receipt_project_id, page_id, occurrence_start_ms, reminder_offset_minutes
  ) WHERE status = 'claimed';
CREATE INDEX idx_core_reminder_leases_inbox
  ON core_reminder_leases(status, expires_at_ms, due_at_ms, lease_id);
CREATE INDEX idx_retired_block_identities_library_time
  ON retired_block_identities(library_id, retired_at, block_id);

CREATE INDEX idx_block_relocations_project_committed
  ON block_relocations(project_id, committed_at, id);
CREATE INDEX idx_block_relocations_library_committed
  ON block_relocations(library_id, committed_at, id);
CREATE INDEX idx_block_relocations_source
  ON block_relocations(source_document_id, source_generation, source_base_head_seq, id);
CREATE INDEX idx_block_relocations_target
  ON block_relocations(target_document_id, target_generation, id)
  WHERE target_document_id IS NOT NULL;
CREATE INDEX idx_block_relocation_members_block
  ON block_relocation_members(block_id, relocation_id);
CREATE INDEX idx_block_relocation_members_roots
  ON block_relocation_members(relocation_id, tree_ordinal) WHERE is_root = 1;

CREATE TRIGGER blocks_identity_is_immutable
BEFORE UPDATE OF id ON blocks WHEN NEW.id IS NOT OLD.id BEGIN
  SELECT RAISE(ABORT, 'Block identity is immutable');
END;

CREATE TRIGGER library_block_placements_validate_insert
BEFORE INSERT ON library_block_placements
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  WHERE block.id = NEW.block_id AND block.library_id = NEW.library_id
    AND block.lifecycle <> 'deleted'
    AND block.type IN (
      'page', 'database', 'canvas', 'synced_block_source', 'reusable_template_source'
    )
) OR EXISTS (
  SELECT 1 FROM document_block_index block_index WHERE block_index.block_id = NEW.block_id
) OR EXISTS (
  SELECT 1 FROM pages page
  WHERE page.block_id = NEW.block_id
    AND (page.library_id <> NEW.library_id OR page.parent_kind <> 'library')
) BEGIN
  SELECT RAISE(ABORT, 'Library placement requires a placeable Library root');
END;
CREATE TRIGGER library_block_placements_validate_update
BEFORE UPDATE OF block_id, library_id ON library_block_placements
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  WHERE block.id = NEW.block_id AND block.library_id = NEW.library_id
    AND block.lifecycle <> 'deleted'
    AND block.type IN (
      'page', 'database', 'canvas', 'synced_block_source', 'reusable_template_source'
    )
) OR EXISTS (
  SELECT 1 FROM document_block_index block_index WHERE block_index.block_id = NEW.block_id
) OR EXISTS (
  SELECT 1 FROM pages page
  WHERE page.block_id = NEW.block_id
    AND (page.library_id <> NEW.library_id OR page.parent_kind <> 'library')
) BEGIN
  SELECT RAISE(ABORT, 'Library placement requires a placeable Library root');
END;

CREATE TRIGGER pages_validate_insert BEFORE INSERT ON pages
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  JOIN documents document ON document.id = NEW.document_id
  JOIN block_documents ownership
    ON ownership.block_id = NEW.block_id
   AND ownership.document_id = NEW.document_id
  WHERE block.id = NEW.block_id AND block.type = 'page'
    AND block.library_id = NEW.library_id
    AND document.library_id = NEW.library_id
    AND ownership.library_id = NEW.library_id
) OR (
  NEW.parent_kind = 'page' AND NOT EXISTS (
    SELECT 1 FROM pages parent
    WHERE parent.block_id = NEW.parent_id AND parent.library_id = NEW.library_id
  )
) OR (
  NEW.parent_kind = 'data_source' AND NOT EXISTS (
    SELECT 1 FROM data_sources source
    WHERE source.id = NEW.parent_id AND source.library_id = NEW.library_id
  )
) OR (
  NEW.parent_kind <> 'library' AND EXISTS (
    SELECT 1 FROM library_block_placements placement
    WHERE placement.block_id = NEW.block_id
  )
) OR (
  NEW.parent_kind <> 'page' AND EXISTS (
    SELECT 1 FROM document_block_index block_index
    WHERE block_index.block_id = NEW.block_id
  )
) BEGIN
  SELECT RAISE(ABORT, 'Page subtype or parent authority is invalid');
END;
CREATE TRIGGER pages_validate_update
BEFORE UPDATE OF block_id, library_id, document_id, parent_kind, parent_id ON pages
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  JOIN documents document ON document.id = NEW.document_id
  JOIN block_documents ownership
    ON ownership.block_id = NEW.block_id
   AND ownership.document_id = NEW.document_id
  WHERE block.id = NEW.block_id AND block.type = 'page'
    AND block.library_id = NEW.library_id
    AND document.library_id = NEW.library_id
    AND ownership.library_id = NEW.library_id
) OR (
  NEW.parent_kind = 'page' AND NOT EXISTS (
    SELECT 1 FROM pages parent
    WHERE parent.block_id = NEW.parent_id AND parent.library_id = NEW.library_id
  )
) OR (
  NEW.parent_kind = 'data_source' AND NOT EXISTS (
    SELECT 1 FROM data_sources source
    WHERE source.id = NEW.parent_id AND source.library_id = NEW.library_id
  )
) OR (
  NEW.parent_kind <> 'library' AND EXISTS (
    SELECT 1 FROM library_block_placements placement
    WHERE placement.block_id = NEW.block_id
  )
) OR (
  NEW.parent_kind <> 'page' AND EXISTS (
    SELECT 1 FROM document_block_index block_index
    WHERE block_index.block_id = NEW.block_id
  )
) BEGIN
  SELECT RAISE(ABORT, 'Page subtype or parent authority is invalid');
END;

CREATE TRIGGER data_source_relation_edges_validate_insert
BEFORE INSERT ON data_source_relation_edges
WHEN NOT EXISTS (
  SELECT 1
  FROM data_source_relation_properties relation
  JOIN data_source_property_values value
    ON value.data_source_id = NEW.source_data_source_id
   AND value.membership_id = NEW.source_membership_id
   AND value.property_id = NEW.property_id
  JOIN blocks target_block ON target_block.id = NEW.target_page_block_id
  JOIN pages target_page
    ON target_page.block_id = target_block.id
   AND target_page.library_id = target_block.library_id
  JOIN data_source_page_memberships target_membership
    ON target_membership.page_block_id = target_block.id
   AND target_membership.data_source_id = relation.target_data_source_id
   AND target_membership.removed_at IS NULL
  WHERE relation.data_source_id = NEW.source_data_source_id
    AND relation.property_id = NEW.property_id
    AND value.value_type = 'relation'
    AND json_type(value.value_json) = 'null'
    AND target_block.type = 'page'
    AND target_block.lifecycle = 'active'
) BEGIN
  SELECT RAISE(ABORT, 'Relation edge requires an active target Page in the configured Data Source');
END;
CREATE TRIGGER data_source_relation_edges_are_immutable
BEFORE UPDATE ON data_source_relation_edges BEGIN
  SELECT RAISE(ABORT, 'Relation edge identity is immutable');
END;

CREATE TRIGGER documents_sync_engine_immutable
BEFORE UPDATE OF sync_engine ON documents WHEN NEW.sync_engine <> OLD.sync_engine BEGIN
  SELECT RAISE(ABORT, 'Owned Document sync engine is immutable');
END;
CREATE TRIGGER yjs_documents_require_empty_state_hash_insert
BEFORE INSERT ON documents
WHEN NEW.sync_engine = 'yjs' AND NEW.state_hash <> '' BEGIN
  SELECT RAISE(ABORT, 'Yjs Document cannot persist a full-state hash');
END;
CREATE TRIGGER yjs_documents_require_empty_state_hash_update
BEFORE UPDATE OF state_hash ON documents
WHEN NEW.sync_engine = 'yjs' AND NEW.state_hash <> '' BEGIN
  SELECT RAISE(ABORT, 'Yjs Document cannot persist a full-state hash');
END;
CREATE TRIGGER canvas_documents_require_empty_yjs_state_insert
BEFORE INSERT ON documents
WHEN NEW.sync_engine = 'canvas_scene'
  AND (length(NEW.state_vector) <> 0 OR NEW.state_hash = '') BEGIN
  SELECT RAISE(ABORT, 'Canvas Document cannot contain Yjs state');
END;
CREATE TRIGGER canvas_documents_require_empty_yjs_state_update
BEFORE UPDATE OF state_vector, state_hash ON documents
WHEN NEW.sync_engine = 'canvas_scene'
  AND (length(NEW.state_vector) <> 0 OR NEW.state_hash = '') BEGIN
  SELECT RAISE(ABORT, 'Canvas Document cannot contain Yjs state');
END;

CREATE TRIGGER data_source_memberships_require_page_parent_insert
BEFORE INSERT ON data_source_page_memberships
WHEN NEW.removed_at IS NULL AND NOT EXISTS (
  SELECT 1
  FROM pages page
  JOIN blocks block ON block.id = page.block_id AND block.type = 'page'
  JOIN data_sources source
    ON source.id = NEW.data_source_id AND source.library_id = block.library_id
  WHERE page.block_id = NEW.page_block_id
    AND page.parent_kind = 'data_source'
    AND page.parent_id = NEW.data_source_id
) BEGIN
  SELECT RAISE(ABORT, 'Active Source membership must match the Page Data Source parent');
END;
CREATE TRIGGER data_source_memberships_require_page_parent_update
BEFORE UPDATE OF data_source_id, page_block_id, removed_at ON data_source_page_memberships
WHEN NEW.removed_at IS NULL AND NOT EXISTS (
  SELECT 1
  FROM pages page
  JOIN blocks block ON block.id = page.block_id AND block.type = 'page'
  JOIN data_sources source
    ON source.id = NEW.data_source_id AND source.library_id = block.library_id
  WHERE page.block_id = NEW.page_block_id
    AND page.parent_kind = 'data_source'
    AND page.parent_id = NEW.data_source_id
) BEGIN
  SELECT RAISE(ABORT, 'Active Source membership must match the Page Data Source parent');
END;

CREATE UNIQUE INDEX idx_document_block_index_single_host
  ON document_block_index(block_id);
CREATE TRIGGER document_block_index_requires_library_content_insert
BEFORE INSERT ON document_block_index
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  JOIN documents document ON document.id = NEW.document_id
  WHERE block.id = NEW.block_id AND block.library_id = document.library_id
    AND block.lifecycle <> 'deleted'
) OR EXISTS (
  SELECT 1 FROM library_block_placements placement WHERE placement.block_id = NEW.block_id
) OR EXISTS (
  SELECT 1 FROM pages page
  WHERE page.block_id = NEW.block_id AND (
    page.parent_kind <> 'page' OR NOT EXISTS (
      SELECT 1 FROM pages parent
      JOIN block_documents parent_document ON parent_document.block_id = parent.block_id
      WHERE parent.block_id = page.parent_id
        AND parent.library_id = page.library_id
        AND parent_document.document_id = NEW.document_id
        AND parent_document.library_id = page.library_id
    )
  )
) BEGIN
  SELECT RAISE(ABORT, 'Indexed Block must belong to the Document Library and not be a Library root');
END;
CREATE TRIGGER document_block_index_requires_library_content_update
BEFORE UPDATE OF document_id, block_id ON document_block_index
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  JOIN documents document ON document.id = NEW.document_id
  WHERE block.id = NEW.block_id AND block.library_id = document.library_id
    AND block.lifecycle <> 'deleted'
) OR EXISTS (
  SELECT 1 FROM library_block_placements placement WHERE placement.block_id = NEW.block_id
) OR EXISTS (
  SELECT 1 FROM pages page
  WHERE page.block_id = NEW.block_id AND (
    page.parent_kind <> 'page' OR NOT EXISTS (
      SELECT 1 FROM pages parent
      JOIN block_documents parent_document ON parent_document.block_id = parent.block_id
      WHERE parent.block_id = page.parent_id
        AND parent.library_id = page.library_id
        AND parent_document.document_id = NEW.document_id
        AND parent_document.library_id = page.library_id
    )
  )
) BEGIN
  SELECT RAISE(ABORT, 'Indexed Block must belong to the Document Library and not be a Library root');
END;
CREATE TRIGGER document_block_index_parent_same_document_insert
BEFORE INSERT ON document_block_index
WHEN NEW.parent_block_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM document_block_index parent
  WHERE parent.document_id = NEW.document_id AND parent.block_id = NEW.parent_block_id
) BEGIN
  SELECT RAISE(ABORT, 'Indexed parent must belong to the indexed Document');
END;
CREATE TRIGGER document_block_index_parent_same_document_update
BEFORE UPDATE OF document_id, parent_block_id ON document_block_index
WHEN NEW.parent_block_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM document_block_index parent
  WHERE parent.document_id = NEW.document_id AND parent.block_id = NEW.parent_block_id
) BEGIN
  SELECT RAISE(ABORT, 'Indexed parent must belong to the indexed Document');
END;

CREATE TRIGGER block_asset_refs_validate_insert BEFORE INSERT ON block_asset_refs
WHEN NOT EXISTS (
  SELECT 1 FROM documents document
  JOIN block_documents ownership
    ON ownership.document_id = document.id AND ownership.library_id = document.library_id
  JOIN document_block_index block_index
    ON block_index.document_id = document.id AND block_index.block_id = NEW.block_id
  WHERE document.id = NEW.document_id AND document.library_id = NEW.library_id
    AND document.generation = NEW.document_generation
    AND document.head_seq >= NEW.projected_seq
    AND ownership.block_id = NEW.owner_block_id
    AND block_index.projected_seq = NEW.projected_seq
) BEGIN
  SELECT RAISE(ABORT, 'Block asset projection source is invalid or from the future');
END;
CREATE TRIGGER block_asset_refs_validate_update BEFORE UPDATE ON block_asset_refs
WHEN NOT EXISTS (
  SELECT 1 FROM documents document
  JOIN block_documents ownership
    ON ownership.document_id = document.id AND ownership.library_id = document.library_id
  JOIN document_block_index block_index
    ON block_index.document_id = document.id AND block_index.block_id = NEW.block_id
  WHERE document.id = NEW.document_id AND document.library_id = NEW.library_id
    AND document.generation = NEW.document_generation
    AND document.head_seq >= NEW.projected_seq
    AND ownership.block_id = NEW.owner_block_id
    AND block_index.projected_seq = NEW.projected_seq
) BEGIN
  SELECT RAISE(ABORT, 'Block asset projection source is invalid or from the future');
END;

CREATE TRIGGER block_search_units_validate_insert BEFORE INSERT ON block_search_units
WHEN (
  NEW.document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM documents document
    JOIN block_documents ownership
      ON ownership.document_id = document.id AND ownership.library_id = document.library_id
    LEFT JOIN document_block_index block_index
      ON block_index.document_id = document.id AND block_index.block_id = NEW.block_id
    WHERE document.id = NEW.document_id AND document.library_id = NEW.library_id
      AND document.generation = NEW.document_generation
      AND document.head_seq >= NEW.projected_seq
      AND ownership.block_id = NEW.owner_block_id
      AND (NEW.block_id = NEW.owner_block_id OR block_index.block_id IS NOT NULL)
  )
) OR (
  NEW.document_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM blocks source
    WHERE source.id = NEW.block_id AND source.library_id = NEW.library_id
      AND source.metadata_revision >= NEW.source_revision
  )
) BEGIN
  SELECT RAISE(ABORT, 'Block search projection source is invalid or from the future');
END;
CREATE TRIGGER block_search_units_validate_update BEFORE UPDATE ON block_search_units
WHEN (
  NEW.document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM documents document
    JOIN block_documents ownership
      ON ownership.document_id = document.id AND ownership.library_id = document.library_id
    LEFT JOIN document_block_index block_index
      ON block_index.document_id = document.id AND block_index.block_id = NEW.block_id
    WHERE document.id = NEW.document_id AND document.library_id = NEW.library_id
      AND document.generation = NEW.document_generation
      AND document.head_seq >= NEW.projected_seq
      AND ownership.block_id = NEW.owner_block_id
      AND (NEW.block_id = NEW.owner_block_id OR block_index.block_id IS NOT NULL)
  )
) OR (
  NEW.document_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM blocks source
    WHERE source.id = NEW.block_id AND source.library_id = NEW.library_id
      AND source.metadata_revision >= NEW.source_revision
  )
) BEGIN
  SELECT RAISE(ABORT, 'Block search projection source is invalid or from the future');
END;

CREATE TRIGGER canvas_page_references_validate_insert
BEFORE INSERT ON canvas_page_references
WHEN NOT EXISTS (
  SELECT 1 FROM blocks target
  WHERE target.id = NEW.target_block_id AND target.library_id = NEW.library_id
) BEGIN
  SELECT RAISE(ABORT, 'Canvas Page reference must remain inside its Library');
END;
CREATE TRIGGER canvas_page_references_validate_update
BEFORE UPDATE OF target_block_id, library_id ON canvas_page_references
WHEN NOT EXISTS (
  SELECT 1 FROM blocks target
  WHERE target.id = NEW.target_block_id AND target.library_id = NEW.library_id
) BEGIN
  SELECT RAISE(ABORT, 'Canvas Page reference must remain inside its Library');
END;

CREATE TRIGGER page_read_model_validate_insert BEFORE INSERT ON page_read_model
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  JOIN pages page ON page.block_id = block.id
  JOIN documents document ON document.id = page.document_id
  LEFT JOIN library_block_placements placement
    ON placement.block_id = page.block_id AND page.parent_kind = 'library'
  WHERE block.id = NEW.page_block_id AND block.library_id = NEW.library_id
    AND block.type = 'page' AND page.parent_kind = NEW.parent_kind
    AND page.parent_id = NEW.parent_id
    AND page.document_id = NEW.document_id
    AND document.library_id = NEW.library_id
    AND document.generation = NEW.document_generation
    AND document.head_seq = NEW.document_projected_seq
    AND document.schema_version = NEW.document_schema_version
    AND document.authority = NEW.document_authority
    AND block.lifecycle = NEW.lifecycle
    AND block.placement_revision = NEW.placement_revision
    AND block.metadata_revision = NEW.metadata_revision
    AND (
      (page.parent_kind = 'library' AND block.lifecycle <> 'deleted'
        AND placement.rank_key = NEW.library_rank_key)
      OR ((page.parent_kind <> 'library' OR block.lifecycle = 'deleted')
        AND NEW.library_rank_key IS NULL)
    )
) OR (
  NEW.membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM data_source_page_memberships membership
    JOIN data_sources source ON source.id = membership.data_source_id
    WHERE membership.id = NEW.membership_id
      AND membership.page_block_id = NEW.page_block_id
      AND membership.removed_at IS NULL
      AND source.home_database_block_id = NEW.database_block_id
  )
) OR (
  NEW.view_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM database_views view
    JOIN data_source_page_memberships membership
      ON membership.id = NEW.membership_id
     AND membership.data_source_id = view.data_source_id
    WHERE view.id = NEW.view_id AND view.database_block_id = NEW.database_block_id
  )
) BEGIN
  SELECT RAISE(ABORT, 'Page read model source coordinates are invalid or stale');
END;
CREATE TRIGGER page_read_model_validate_update BEFORE UPDATE ON page_read_model
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  JOIN pages page ON page.block_id = block.id
  JOIN documents document ON document.id = page.document_id
  LEFT JOIN library_block_placements placement
    ON placement.block_id = page.block_id AND page.parent_kind = 'library'
  WHERE block.id = NEW.page_block_id AND block.library_id = NEW.library_id
    AND block.type = 'page' AND page.parent_kind = NEW.parent_kind
    AND page.parent_id = NEW.parent_id
    AND page.document_id = NEW.document_id
    AND document.library_id = NEW.library_id
    AND document.generation = NEW.document_generation
    AND document.head_seq = NEW.document_projected_seq
    AND document.schema_version = NEW.document_schema_version
    AND document.authority = NEW.document_authority
    AND block.lifecycle = NEW.lifecycle
    AND block.placement_revision = NEW.placement_revision
    AND block.metadata_revision = NEW.metadata_revision
    AND (
      (page.parent_kind = 'library' AND block.lifecycle <> 'deleted'
        AND placement.rank_key = NEW.library_rank_key)
      OR ((page.parent_kind <> 'library' OR block.lifecycle = 'deleted')
        AND NEW.library_rank_key IS NULL)
    )
) OR (
  NEW.membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM data_source_page_memberships membership
    JOIN data_sources source ON source.id = membership.data_source_id
    WHERE membership.id = NEW.membership_id
      AND membership.page_block_id = NEW.page_block_id
      AND membership.removed_at IS NULL
      AND source.home_database_block_id = NEW.database_block_id
  )
) OR (
  NEW.view_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM database_views view
    JOIN data_source_page_memberships membership
      ON membership.id = NEW.membership_id
     AND membership.data_source_id = view.data_source_id
    WHERE view.id = NEW.view_id AND view.database_block_id = NEW.database_block_id
  )
) BEGIN
  SELECT RAISE(ABORT, 'Page read model source coordinates are invalid or stale');
END;

CREATE TRIGGER recurrence_exceptions_require_page_insert BEFORE INSERT ON recurrence_exceptions
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  WHERE block.id = NEW.page_id AND block.library_id = NEW.library_id AND block.type = 'page'
) BEGIN
  SELECT RAISE(ABORT, 'Recurrence exception owner must be a Page in the Library');
END;
CREATE TRIGGER recurrence_exceptions_require_page_update
BEFORE UPDATE OF page_id, library_id ON recurrence_exceptions
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  WHERE block.id = NEW.page_id AND block.library_id = NEW.library_id AND block.type = 'page'
) BEGIN
  SELECT RAISE(ABORT, 'Recurrence exception owner must be a Page in the Library');
END;

CREATE TRIGGER reminder_receipts_validate_insert BEFORE INSERT ON reminder_receipts
WHEN NOT EXISTS (
  SELECT 1 FROM projects project
  JOIN blocks page ON page.id = NEW.page_id AND page.library_id = project.library_id
  WHERE project.id = NEW.project_id AND project.library_id = NEW.library_id
    AND page.type = 'page'
) BEGIN
  SELECT RAISE(ABORT, 'Reminder receipt Project and Page must share a Library');
END;
CREATE TRIGGER reminder_receipts_validate_update
BEFORE UPDATE OF project_id, library_id, page_id ON reminder_receipts
WHEN NOT EXISTS (
  SELECT 1 FROM projects project
  JOIN blocks page ON page.id = NEW.page_id AND page.library_id = project.library_id
  WHERE project.id = NEW.project_id AND project.library_id = NEW.library_id
    AND page.type = 'page'
) BEGIN
  SELECT RAISE(ABORT, 'Reminder receipt Project and Page must share a Library');
END;
CREATE TRIGGER reminder_snoozes_validate_insert BEFORE INSERT ON reminder_snoozes
WHEN NOT EXISTS (
  SELECT 1 FROM projects project
  JOIN blocks page ON page.id = NEW.page_id AND page.library_id = project.library_id
  WHERE project.id = NEW.project_id AND project.library_id = NEW.library_id
    AND page.type = 'page'
) BEGIN
  SELECT RAISE(ABORT, 'Reminder snooze Project and Page must share a Library');
END;
CREATE TRIGGER reminder_snoozes_validate_update
BEFORE UPDATE OF project_id, library_id, page_id ON reminder_snoozes
WHEN NOT EXISTS (
  SELECT 1 FROM projects project
  JOIN blocks page ON page.id = NEW.page_id AND page.library_id = project.library_id
  WHERE project.id = NEW.project_id AND project.library_id = NEW.library_id
    AND page.type = 'page'
) BEGIN
  SELECT RAISE(ABORT, 'Reminder snooze Project and Page must share a Library');
END;

CREATE TRIGGER scheduled_page_index_require_page_insert BEFORE INSERT ON scheduled_page_index
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  WHERE block.id = NEW.page_block_id AND block.library_id = NEW.library_id
    AND block.type = 'page'
    AND block.lifecycle = NEW.lifecycle
    AND block.metadata_revision = NEW.source_metadata_revision
) BEGIN
  SELECT RAISE(ABORT, 'Scheduled Page index owner must be a Page in the Library');
END;
CREATE TRIGGER scheduled_page_index_require_page_update
BEFORE UPDATE OF page_block_id, library_id ON scheduled_page_index
WHEN NOT EXISTS (
  SELECT 1 FROM blocks block
  WHERE block.id = NEW.page_block_id AND block.library_id = NEW.library_id
    AND block.type = 'page'
    AND block.lifecycle = NEW.lifecycle
    AND block.metadata_revision = NEW.source_metadata_revision
) BEGIN
  SELECT RAISE(ABORT, 'Scheduled Page index owner must be a Page in the Library');
END;

CREATE TRIGGER retired_block_identities_are_immutable_delete
BEFORE DELETE ON retired_block_identities BEGIN
  SELECT RAISE(ABORT, 'Retired Block identity evidence is immutable');
END;
CREATE TRIGGER retired_block_identities_are_immutable_update
BEFORE UPDATE ON retired_block_identities BEGIN
  SELECT RAISE(ABORT, 'Retired Block identity evidence is immutable');
END;

CREATE TRIGGER block_relocations_are_immutable BEFORE UPDATE ON block_relocations BEGIN
  SELECT RAISE(ABORT, 'Committed Block relocations are immutable');
END;
CREATE TRIGGER block_relocations_validate_insert BEFORE INSERT ON block_relocations
WHEN NOT EXISTS (
  SELECT 1 FROM projects actor
  JOIN documents source
    ON source.id = NEW.source_document_id AND source.library_id = actor.library_id
  LEFT JOIN documents target ON target.id = NEW.target_document_id
  WHERE actor.id = NEW.project_id AND actor.library_id = NEW.library_id
    AND (NEW.target_document_id IS NULL OR target.library_id = NEW.library_id)
    AND (
      NEW.target_parent_block_id IS NULL OR EXISTS (
        SELECT 1 FROM document_block_index parent
        WHERE parent.document_id = NEW.target_document_id
          AND parent.block_id = NEW.target_parent_block_id
      )
    )
    AND (
      NEW.target_before_block_id IS NULL OR EXISTS (
        SELECT 1 FROM document_block_index sibling
        WHERE sibling.document_id = NEW.target_document_id
          AND sibling.block_id = NEW.target_before_block_id
      )
    )
) BEGIN
  SELECT RAISE(ABORT, 'Block relocation coordinates must remain inside the actor Library');
END;
CREATE TRIGGER block_relocation_members_are_immutable
BEFORE UPDATE ON block_relocation_members BEGIN
  SELECT RAISE(ABORT, 'Committed Block relocation members are immutable');
END;
CREATE TRIGGER block_relocation_members_validate_insert
BEFORE INSERT ON block_relocation_members
WHEN NOT EXISTS (
  SELECT 1 FROM block_relocations relocation
  JOIN blocks block ON block.id = NEW.block_id
  WHERE relocation.id = NEW.relocation_id
    AND relocation.library_id = NEW.library_id
    AND block.library_id = NEW.library_id
) BEGIN
  SELECT RAISE(ABORT, 'Block relocation member must remain inside its Library');
END;
"#;

#[derive(Clone, Debug)]
struct LegacyRoot {
    block_id: String,
    project_id: String,
    library_id: String,
    _rank_key: String,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug)]
struct LegacyPageAccess {
    project_id: String,
    library_id: String,
    parent_kind: String,
    parent_id: String,
    created_at: String,
    updated_at: String,
}

pub(super) fn ensure_v117_library_content_ownership(
    connection: &Connection,
) -> Result<(), StoreError> {
    if table_has_column(connection, "blocks", "library_id")? {
        return validate_v117_library_content_ownership(connection);
    }
    if !table_has_column(connection, "blocks", "project_id")? {
        return Err(corrupt(
            "Block registry has neither Project-owned nor Library-owned coordinates",
        ));
    }

    super::visibility_delta_journal::with_maintenance_context(connection, |connection| {
        ensure_legacy_project_library_coordinates(connection)?;
        validate_legacy_content_coordinates(connection)?;
        materialize_legacy_project_page_access(connection)?;
        converge_library_root_placements(connection)?;
        drop_legacy_location_triggers(connection)?;
        connection.execute_batch(V117_TABLES_SQL)?;
        connection.execute_batch(V117_COPY_SQL)?;
        connection.execute_batch(V117_SWAP_SQL)?;
        connection.execute_batch(V117_INDEXES_AND_TRIGGERS_SQL)?;
        refresh_cross_table_content_triggers(connection)?;
        super::visibility_delta_journal::refresh_library_content_authority_triggers(connection)?;
        validate_v117_library_content_ownership(connection)
    })
}

/// The retired physical owner used to grant its Project implicit access to a
/// Page. Convert only the maximal uncovered Page roots into durable grants so
/// the cutover removes that hidden authorization path without silently
/// revoking existing Project workflows or emitting one grant per descendant.
fn materialize_legacy_project_page_access(connection: &Connection) -> Result<(), StoreError> {
    let pages = connection
        .prepare(
            "SELECT page.block_id, block.project_id, page.library_id, page.parent_kind, \
                    page.parent_id, page.created_at, page.updated_at \
             FROM pages page \
             JOIN blocks block ON block.id = page.block_id \
             WHERE block.lifecycle <> 'deleted' \
             ORDER BY page.block_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                LegacyPageAccess {
                    project_id: row.get(1)?,
                    library_id: row.get(2)?,
                    parent_kind: row.get(3)?,
                    parent_id: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                },
            ))
        })?
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()?;
    let source_databases = connection
        .prepare("SELECT id, home_database_block_id FROM data_sources ORDER BY id")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()?;
    let primary_databases = connection
        .prepare(
            "SELECT project.id, COALESCE(project.database_block_id, binding.database_block_id) \
             FROM projects project \
             LEFT JOIN project_database_bindings binding \
               ON binding.project_id = project.id AND binding.library_id = project.library_id \
              AND binding.lifecycle = 'active' \
             ORDER BY project.id",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()?;
    let grants = connection
        .prepare(
            "SELECT project_id, root_kind, root_id FROM project_resource_grants \
             WHERE lifecycle = 'active' ORDER BY project_id, root_kind, root_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut page_grants = grants
        .iter()
        .filter(|(_, kind, _)| kind == "page")
        .map(|(project_id, _, page_id)| (project_id.clone(), page_id.clone()))
        .collect::<BTreeSet<_>>();
    let database_grants = grants
        .iter()
        .filter(|(_, kind, _)| kind == "database")
        .map(|(project_id, _, database_id)| (project_id.clone(), database_id.clone()))
        .collect::<BTreeSet<_>>();

    for (page_id, page) in &pages {
        if legacy_page_access_is_covered(
            page_id,
            &page.project_id,
            &pages,
            &source_databases,
            &primary_databases,
            &page_grants,
            &database_grants,
        )? {
            continue;
        }
        if legacy_page_has_owner_ancestor(page_id, &page.project_id, &pages)? {
            continue;
        }

        let mut digest = Sha256::new();
        digest.update(b"nodex.v117.legacy-page-grant\0");
        digest.update(page.project_id.as_bytes());
        digest.update(b"\0");
        digest.update(page_id.as_bytes());
        let grant_id = format!("grant:v117:{}", hex::encode(digest.finalize()));
        connection.execute(
            "INSERT INTO project_resource_grants( \
               id, project_id, library_id, root_kind, root_id, access, recursive, revision, \
               lifecycle, created_at, updated_at \
             ) VALUES (?1, ?2, ?3, 'page', ?4, 'read_write', 1, 1, 'active', ?5, ?6)",
            params![
                grant_id,
                page.project_id,
                page.library_id,
                page_id,
                page.created_at,
                page.updated_at,
            ],
        )?;
        page_grants.insert((page.project_id.clone(), page_id.clone()));
    }
    Ok(())
}

fn legacy_page_has_owner_ancestor(
    page_id: &str,
    project_id: &str,
    pages: &BTreeMap<String, LegacyPageAccess>,
) -> Result<bool, StoreError> {
    let mut current = pages
        .get(page_id)
        .ok_or_else(|| corrupt("Legacy Page access coordinate disappeared"))?;
    let mut visited = BTreeSet::from([page_id.to_owned()]);
    while current.parent_kind == "page" {
        if !visited.insert(current.parent_id.clone()) {
            return Err(corrupt("Legacy Page ownership contains a cycle"));
        }
        current = pages
            .get(&current.parent_id)
            .ok_or_else(|| corrupt("Legacy Page ownership parent is missing"))?;
        if current.project_id == project_id {
            return Ok(true);
        }
    }
    Ok(false)
}

#[allow(clippy::too_many_arguments)]
fn legacy_page_access_is_covered(
    page_id: &str,
    project_id: &str,
    pages: &BTreeMap<String, LegacyPageAccess>,
    source_databases: &BTreeMap<String, String>,
    primary_databases: &BTreeMap<String, Option<String>>,
    page_grants: &BTreeSet<(String, String)>,
    database_grants: &BTreeSet<(String, String)>,
) -> Result<bool, StoreError> {
    let mut current_id = page_id;
    let mut visited = BTreeSet::new();
    loop {
        if !visited.insert(current_id.to_owned()) {
            return Err(corrupt("Legacy Page ownership contains a cycle"));
        }
        if page_grants.contains(&(project_id.to_owned(), current_id.to_owned())) {
            return Ok(true);
        }
        let current = pages
            .get(current_id)
            .ok_or_else(|| corrupt("Legacy Page ownership parent is missing"))?;
        match current.parent_kind.as_str() {
            "page" => current_id = &current.parent_id,
            "library" => return Ok(false),
            "data_source" => {
                let database_id = source_databases
                    .get(&current.parent_id)
                    .ok_or_else(|| corrupt("Legacy Page Data Source parent is missing"))?;
                let primary = primary_databases.get(project_id).and_then(Option::as_deref)
                    == Some(database_id.as_str());
                let directly_granted =
                    database_grants.contains(&(project_id.to_owned(), database_id.to_owned()));
                return Ok(primary || directly_granted);
            }
            _ => return Err(corrupt("Legacy Page parent kind is invalid")),
        }
    }
}

fn ensure_legacy_project_library_coordinates(connection: &Connection) -> Result<(), StoreError> {
    let missing = connection.query_row(
        "SELECT count(*) FROM projects WHERE library_id IS NULL",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if missing == 0 {
        return Ok(());
    }

    let conflicting_inference = connection.query_row(
        "SELECT count(*) FROM projects project
         JOIN project_database_bindings binding ON binding.project_id = project.id
         JOIN database_containers container ON container.block_id = project.database_block_id
         WHERE project.library_id IS NULL AND binding.library_id <> container.library_id",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if conflicting_inference != 0 {
        return Err(corrupt(format!(
            "{conflicting_inference} legacy Projects have conflicting Library coordinates"
        )));
    }

    connection.execute(
        "UPDATE projects
         SET library_id = COALESCE(
           (SELECT binding.library_id FROM project_database_bindings binding
            WHERE binding.project_id = projects.id),
           (SELECT container.library_id FROM database_containers container
            WHERE container.block_id = projects.database_block_id)
         )
         WHERE library_id IS NULL AND (
           EXISTS (SELECT 1 FROM project_database_bindings binding
                   WHERE binding.project_id = projects.id)
           OR EXISTS (SELECT 1 FROM database_containers container
                      WHERE container.block_id = projects.database_block_id)
         )",
        [],
    )?;

    let remaining = connection.query_row(
        "SELECT count(*) FROM projects WHERE library_id IS NULL",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if remaining == 0 {
        return Ok(());
    }

    let library_ids = connection
        .prepare("SELECT id FROM libraries ORDER BY id LIMIT 2")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let library_id = match library_ids.as_slice() {
        [library_id] => library_id.clone(),
        [] => create_legacy_fallback_library(connection)?,
        _ => {
            return Err(corrupt(format!(
                "{remaining} legacy Projects have ambiguous Library ownership"
            )));
        }
    };
    connection.execute(
        "UPDATE projects SET library_id = ?1 WHERE library_id IS NULL",
        [library_id],
    )?;
    Ok(())
}

fn create_legacy_fallback_library(connection: &Connection) -> Result<String, StoreError> {
    const PROFILE_ID: &str = "profile:legacy-content-v117";
    const LIBRARY_ID: &str = "library:legacy-content-v117";
    const MIGRATION_TIME: &str = "1970-01-01T00:00:00.000Z";

    let profile_ids = connection
        .prepare("SELECT id FROM profiles ORDER BY id LIMIT 2")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let profile_id = match profile_ids.as_slice() {
        [profile_id] => profile_id.clone(),
        [] => {
            connection.execute(
                "INSERT INTO profiles(id, created_at, updated_at) VALUES (?1, ?2, ?2)",
                params![PROFILE_ID, MIGRATION_TIME],
            )?;
            PROFILE_ID.to_owned()
        }
        _ => {
            return Err(corrupt(
                "Legacy content has no Library and more than one candidate Profile",
            ));
        }
    };
    connection.execute(
        "INSERT INTO libraries(id, profile_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)",
        params![LIBRARY_ID, profile_id, MIGRATION_TIME],
    )?;
    Ok(LIBRARY_ID.to_owned())
}

fn table_has_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, StoreError> {
    let count = connection.query_row(
        "SELECT count(*) FROM pragma_table_info(?1) WHERE name = ?2",
        params![table_name, column_name],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count == 1)
}

fn validate_legacy_content_coordinates(connection: &Connection) -> Result<(), StoreError> {
    let missing_project_library = connection.query_row(
        "SELECT count(*) FROM blocks block LEFT JOIN projects project ON project.id = block.project_id \
         WHERE project.library_id IS NULL",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if missing_project_library != 0 {
        return Err(corrupt(format!(
            "{missing_project_library} Blocks have no owning Project Library"
        )));
    }

    let page_coordinate_mismatches = connection.query_row(
        "SELECT count(*) FROM pages page \
         JOIN blocks block ON block.id = page.block_id \
         JOIN projects project ON project.id = block.project_id \
         LEFT JOIN data_sources source \
           ON page.parent_kind = 'data_source' AND source.id = page.parent_id \
         LEFT JOIN pages parent_page \
           ON page.parent_kind = 'page' AND parent_page.block_id = page.parent_id \
         LEFT JOIN block_documents parent_owner \
           ON parent_owner.block_id = parent_page.block_id \
         WHERE page.library_id <> project.library_id \
            OR page.lifecycle <> block.lifecycle \
            OR page.metadata_revision <> block.metadata_revision \
            OR page.parent_revision <> block.location_revision \
            OR (page.parent_kind = 'library' AND ( \
                 page.parent_id <> page.library_id \
                 OR block.location_kind <> 'space' \
                 OR block.containing_document_id IS NOT NULL \
                 OR block.containing_database_id IS NOT NULL \
               )) \
            OR (page.parent_kind = 'page' AND ( \
                 parent_owner.document_id IS NULL \
                 OR block.location_kind <> 'document' \
                 OR block.containing_document_id <> parent_owner.document_id \
                 OR block.containing_database_id IS NOT NULL \
               )) \
            OR (page.parent_kind = 'data_source' AND ( \
                 source.id IS NULL \
                 OR source.library_id <> page.library_id \
                 OR block.location_kind <> 'database' \
                 OR block.containing_document_id IS NOT NULL \
                 OR block.containing_database_id <> source.home_database_block_id \
               ))",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if page_coordinate_mismatches != 0 {
        return Err(corrupt(format!(
            "{page_coordinate_mismatches} Pages disagree with the typed parent authority"
        )));
    }

    let document_library_mismatches = connection.query_row(
        "SELECT count(*) FROM block_documents ownership \
         JOIN blocks block ON block.id = ownership.block_id \
         JOIN documents document ON document.id = ownership.document_id \
         JOIN projects block_project ON block_project.id = block.project_id \
         JOIN projects document_project ON document_project.id = document.project_id \
         WHERE ownership.project_id <> block.project_id \
            OR ownership.project_id <> document.project_id \
            OR block_project.library_id <> document_project.library_id",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if document_library_mismatches != 0 {
        return Err(corrupt(format!(
            "{document_library_mismatches} owned Documents cross a Library boundary"
        )));
    }
    Ok(())
}

fn converge_library_root_placements(connection: &Connection) -> Result<(), StoreError> {
    let legacy_roots = connection
        .prepare(
            "SELECT placement.block_id, placement.project_id, project.library_id, \
                    placement.rank_key, placement.created_at, placement.updated_at \
             FROM top_level_block_placements placement \
             JOIN projects project ON project.id = placement.project_id \
             ORDER BY project.library_id, placement.project_id, placement.rank_key, \
                      placement.block_id",
        )?
        .query_map([], |row| {
            Ok(LegacyRoot {
                block_id: row.get(0)?,
                project_id: row.get(1)?,
                library_id: row.get(2)?,
                _rank_key: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut legacy_by_project = BTreeMap::<String, Vec<String>>::new();
    for root in &legacy_roots {
        legacy_by_project
            .entry(root.project_id.clone())
            .or_default()
            .push(root.block_id.clone());
    }

    let mut current_by_library = read_library_ranked_items(connection)?;
    let current_ids = current_by_library
        .values()
        .flat_map(|items| items.iter().map(|item| item.id.clone()))
        .collect::<BTreeSet<_>>();
    for root in legacy_roots
        .iter()
        .filter(|root| !current_ids.contains(&root.block_id))
    {
        let project_order = legacy_by_project
            .get(&root.project_id)
            .ok_or_else(|| corrupt("Legacy root Project order disappeared"))?;
        let position = project_order
            .iter()
            .position(|id| id == &root.block_id)
            .ok_or_else(|| corrupt("Legacy root disappeared from its Project order"))?;
        let items = current_by_library
            .entry(root.library_id.clone())
            .or_default();
        let item_ids = items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<BTreeSet<_>>();
        let predecessor = project_order[..position]
            .iter()
            .rev()
            .find(|id| item_ids.contains(id.as_str()));
        let successor = project_order[position + 1..]
            .iter()
            .find(|id| item_ids.contains(id.as_str()));
        let before_id = predecessor
            .and_then(|predecessor| {
                items
                    .iter()
                    .position(|item| &item.id == predecessor)
                    .and_then(|index| items.get(index + 1))
                    .map(|item| item.id.as_str())
            })
            .or_else(|| successor.map(String::as_str));
        let plan = plan_fractional_rank(items, &root.block_id, before_id).map_err(|error| {
            corrupt(format!(
                "Cannot converge Library root order: {}",
                error.message
            ))
        })?;
        for (block_id, rank_key) in &plan.rebalanced_rank_keys {
            connection.execute(
                "UPDATE library_block_placements SET rank_key = ?1 WHERE block_id = ?2",
                params![rank_key, block_id],
            )?;
        }
        connection.execute(
            "INSERT INTO library_block_placements( \
               block_id, library_id, rank_key, revision, created_at, updated_at \
             ) VALUES (?1, ?2, ?3, 1, ?4, ?5)",
            params![
                root.block_id,
                root.library_id,
                plan.rank_key,
                root.created_at,
                root.updated_at,
            ],
        )?;
        items.push(RankedItem {
            id: root.block_id.clone(),
            rank_key: plan.rank_key,
        });
        for item in items.iter_mut() {
            if let Some(rank_key) = plan.rebalanced_rank_keys.get(&item.id) {
                item.rank_key.clone_from(rank_key);
            }
        }
        items.sort_by(|left, right| {
            left.rank_key
                .cmp(&right.rank_key)
                .then_with(|| left.id.cmp(&right.id))
        });
    }
    Ok(())
}

fn read_library_ranked_items(
    connection: &Connection,
) -> Result<BTreeMap<String, Vec<RankedItem>>, StoreError> {
    let rows = connection
        .prepare(
            "SELECT library_id, block_id, rank_key FROM library_block_placements \
             ORDER BY library_id, rank_key, block_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                RankedItem {
                    id: row.get(1)?,
                    rank_key: row.get(2)?,
                },
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut by_library = BTreeMap::<String, Vec<RankedItem>>::new();
    for (library_id, item) in rows {
        by_library.entry(library_id).or_default().push(item);
    }
    Ok(by_library)
}

fn drop_legacy_location_triggers(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(
        r#"
        DROP TRIGGER IF EXISTS blocks_active_source_membership_requires_database_location;
        DROP TRIGGER IF EXISTS blocks_non_space_location_has_no_top_level_placement;
        DROP TRIGGER IF EXISTS data_source_memberships_require_page_block_insert;
        DROP TRIGGER IF EXISTS data_source_memberships_require_page_block_update;
        DROP TRIGGER IF EXISTS document_block_index_parent_requires_matching_location;
        DROP TRIGGER IF EXISTS document_block_index_parent_updates_require_matching_location;
        DROP TRIGGER IF EXISTS document_block_index_requires_matching_location;
        DROP TRIGGER IF EXISTS document_block_index_updates_require_matching_location;
        DROP TRIGGER IF EXISTS top_level_block_placements_require_space;
        DROP TRIGGER IF EXISTS top_level_block_placements_updates_require_space;
        DROP TRIGGER IF EXISTS page_behavior_records_guard_block_retype;
        DROP TRIGGER IF EXISTS database_containers_require_database_block_insert;
        DROP TRIGGER IF EXISTS database_containers_require_database_block_update;
        DROP TRIGGER IF EXISTS canvas_owners_validate_insert;
        DROP TRIGGER IF EXISTS recurrence_exceptions_require_card_block_insert;
        DROP TRIGGER IF EXISTS recurrence_exceptions_require_card_block_update;
        DROP TRIGGER IF EXISTS reminder_receipts_require_card_block_insert;
        DROP TRIGGER IF EXISTS reminder_receipts_require_card_block_update;
        DROP TRIGGER IF EXISTS reminder_snoozes_require_page_insert;
        DROP TRIGGER IF EXISTS reminder_snoozes_require_page_update;
        DROP TRIGGER IF EXISTS scheduled_card_index_require_card_block_insert;
        DROP TRIGGER IF EXISTS scheduled_card_index_require_card_block_update;
        DROP TRIGGER IF EXISTS block_mutations_validate_insert;
        DROP TRIGGER IF EXISTS document_versions_validate_insert;
        DROP TRIGGER IF EXISTS data_source_relation_edges_validate_insert;
        DROP TRIGGER IF EXISTS data_source_relation_edges_are_immutable;
        "#,
    )?;
    Ok(())
}

fn refresh_cross_table_content_triggers(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(
        r#"
        CREATE TRIGGER database_containers_require_database_block_insert
        BEFORE INSERT ON database_containers
        WHEN NOT EXISTS (
          SELECT 1 FROM blocks block
          WHERE block.id = NEW.block_id AND block.library_id = NEW.library_id
            AND block.type = 'database'
        ) BEGIN
          SELECT RAISE(ABORT, 'Database Container requires a Database Block in the Library');
        END;
        CREATE TRIGGER database_containers_require_database_block_update
        BEFORE UPDATE OF block_id, library_id ON database_containers
        WHEN NOT EXISTS (
          SELECT 1 FROM blocks block
          WHERE block.id = NEW.block_id AND block.library_id = NEW.library_id
            AND block.type = 'database'
        ) BEGIN
          SELECT RAISE(ABORT, 'Database Container requires a Database Block in the Library');
        END;
        CREATE TRIGGER canvas_owners_validate_insert
        BEFORE INSERT ON canvas_owners
        WHEN NOT EXISTS (
          SELECT 1 FROM blocks block
          JOIN block_documents ownership ON ownership.block_id = block.id
          JOIN documents document ON document.id = ownership.document_id
          WHERE block.id = NEW.block_id AND block.type = 'canvas'
            AND block.library_id = NEW.library_id
            AND ownership.library_id = NEW.library_id
            AND document.library_id = NEW.library_id
            AND document.sync_engine = 'canvas_scene'
        ) BEGIN
          SELECT RAISE(ABORT, 'Canvas owner metadata requires a Canvas Document owner');
        END;
        CREATE TRIGGER page_behavior_records_guard_block_retype
        BEFORE UPDATE OF type ON blocks
        WHEN NEW.type <> OLD.type AND (
          EXISTS (SELECT 1 FROM pages page WHERE page.block_id = OLD.id)
          OR EXISTS (SELECT 1 FROM database_containers container WHERE container.block_id = OLD.id)
          OR EXISTS (SELECT 1 FROM canvas_owners canvas WHERE canvas.block_id = OLD.id)
        ) BEGIN
          SELECT RAISE(ABORT, 'Registered Block subtype cannot be retyped');
        END;
        CREATE TRIGGER block_mutations_validate_insert
        BEFORE INSERT ON block_mutations
        WHEN NEW.store_epoch <> COALESCE((
            SELECT store_epoch FROM block_store_metadata WHERE id = 1
          ), '')
          OR EXISTS (
            SELECT 1 FROM json_each(NEW.target_block_ids_json) target
            WHERE target.type <> 'text' OR length(target.value) = 0
          )
          OR (SELECT COUNT(*) FROM json_each(NEW.target_block_ids_json)) <> (
            SELECT COUNT(DISTINCT target.value)
            FROM json_each(NEW.target_block_ids_json) target
          )
          OR EXISTS (
            SELECT 1 FROM json_each(NEW.field_intents_json) intent
            WHERE intent.type <> 'object'
              OR json_type(intent.value, '$.path') <> 'text'
              OR length(json_extract(intent.value, '$.path')) = 0
              OR json_type(intent.value, '$.operation') <> 'text'
              OR length(json_extract(intent.value, '$.operation')) = 0
          )
          OR (
            NEW.outcome = 'committed' AND (
              EXISTS (
                SELECT 1 FROM json_each(NEW.target_block_ids_json) target
                WHERE NOT EXISTS (
                  SELECT 1 FROM blocks block
                  JOIN projects actor_project
                    ON actor_project.id = NEW.project_id
                   AND actor_project.library_id = block.library_id
                  WHERE block.id = target.value
                )
              )
              OR NOT EXISTS (
                SELECT 1 FROM change_log change
                WHERE change.seq = NEW.change_log_seq
                  AND change.project_id = NEW.project_id
                  AND change.store_epoch = NEW.store_epoch
                  AND change.operation_id = NEW.mutation_id
              )
            )
          )
        BEGIN
          SELECT RAISE(ABORT, 'Block mutation scope, intent, or result cursor is invalid');
        END;
        CREATE TRIGGER document_versions_validate_insert
        BEFORE INSERT ON document_versions
        WHEN NOT EXISTS (
          SELECT 1 FROM documents document
          JOIN projects actor_project
            ON actor_project.id = NEW.project_id
           AND actor_project.library_id = document.library_id
          WHERE document.id = NEW.document_id
            AND document.readiness = 'ready'
            AND document.generation = NEW.generation
            AND document.head_seq >= NEW.base_head_seq
            AND document.schema_key = NEW.schema_key
            AND document.schema_version = NEW.schema_version
        ) BEGIN
          SELECT RAISE(ABORT, 'Document version source is not a current ready Document');
        END;
        "#,
    )?;
    Ok(())
}

pub(super) fn validate_v117_library_content_ownership(
    connection: &Connection,
) -> Result<(), StoreError> {
    let dangling_foreign_key = connection
        .query_row(
            "SELECT child.name, foreign_key.\"table\" \
             FROM sqlite_schema child \
             JOIN pragma_foreign_key_list(child.name) foreign_key \
             WHERE child.type = 'table' AND child.name NOT LIKE 'sqlite_%' \
               AND NOT EXISTS ( \
                 SELECT 1 FROM sqlite_schema parent \
                 WHERE parent.type = 'table' AND parent.name = foreign_key.\"table\" \
               ) \
             ORDER BY child.name, foreign_key.\"table\" LIMIT 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((child, parent)) = dangling_foreign_key {
        return Err(corrupt(format!(
            "Table {child} still references retired foreign-key parent {parent}"
        )));
    }

    for retired in [
        "top_level_block_placements",
        "library_content_relocations",
        "library_content_relocation_members",
    ] {
        let exists = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
            [retired],
            |row| row.get::<_, bool>(0),
        )?;
        if exists {
            return Err(corrupt(format!(
                "Retired content authority {retired} still exists"
            )));
        }
    }
    for retired_column in [
        "project_id",
        "location_kind",
        "containing_document_id",
        "containing_database_id",
        "location_revision",
    ] {
        if table_has_column(connection, "blocks", retired_column)? {
            return Err(corrupt(format!(
                "Block registry still exposes retired column {retired_column}"
            )));
        }
    }
    if !table_has_column(connection, "blocks", "library_id")?
        || !table_has_column(connection, "blocks", "placement_revision")?
        || !table_has_column(connection, "documents", "library_id")?
    {
        return Err(corrupt("Library-owned content registry is incomplete"));
    }

    let ownership_mismatch = connection.query_row(
        "SELECT count(*) FROM block_documents ownership \
         JOIN blocks block ON block.id = ownership.block_id \
         JOIN documents document ON document.id = ownership.document_id \
         WHERE ownership.library_id <> block.library_id \
            OR ownership.library_id <> document.library_id",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if ownership_mismatch != 0 {
        return Err(corrupt(format!(
            "{ownership_mismatch} Block/Document ownership rows cross a Library"
        )));
    }

    let page_parent_mismatch = connection.query_row(
        "SELECT count(*) FROM pages page \
         JOIN blocks block ON block.id = page.block_id \
         JOIN block_documents ownership ON ownership.block_id = page.block_id \
         WHERE page.library_id <> block.library_id \
            OR block.type <> 'page' \
            OR ownership.library_id <> page.library_id \
            OR ownership.document_id <> page.document_id \
            OR (block.lifecycle <> 'deleted' \
                AND page.parent_kind = 'library' AND NOT EXISTS ( \
                 SELECT 1 FROM library_block_placements placement \
                 WHERE placement.block_id = page.block_id \
                   AND placement.library_id = page.library_id \
               )) \
            OR ((block.lifecycle = 'deleted' OR page.parent_kind <> 'library') AND EXISTS ( \
                 SELECT 1 FROM library_block_placements placement \
                 WHERE placement.block_id = page.block_id \
               )) \
            OR (block.lifecycle <> 'deleted' \
                AND page.parent_kind = 'data_source' AND NOT EXISTS ( \
                 SELECT 1 FROM data_source_page_memberships membership \
                 WHERE membership.page_block_id = page.block_id \
                   AND membership.data_source_id = page.parent_id \
                   AND membership.removed_at IS NULL \
               )) \
            OR (block.lifecycle <> 'deleted' \
                AND page.parent_kind = 'page' AND NOT EXISTS ( \
                 SELECT 1 FROM pages parent \
                 WHERE parent.block_id = page.parent_id \
                   AND parent.library_id = page.library_id \
               )) \
            OR (block.lifecycle <> 'deleted' \
                AND page.parent_kind = 'page' AND NOT EXISTS ( \
                 SELECT 1 FROM document_block_index block_index \
                 JOIN block_documents parent_document \
                   ON parent_document.document_id = block_index.document_id \
                 WHERE block_index.block_id = page.block_id \
                   AND parent_document.block_id = page.parent_id \
                   AND parent_document.library_id = page.library_id \
               )) \
            OR (block.lifecycle = 'deleted' AND EXISTS ( \
                 SELECT 1 FROM data_source_page_memberships membership \
                 WHERE membership.page_block_id = page.block_id \
                   AND membership.removed_at IS NULL \
               ))",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if page_parent_mismatch != 0 {
        return Err(corrupt(format!(
            "{page_parent_mismatch} Pages disagree with their typed parent authority"
        )));
    }

    let placement_mismatch = connection.query_row(
        "SELECT count(*) FROM library_block_placements placement \
         LEFT JOIN blocks block ON block.id = placement.block_id \
         LEFT JOIN pages page ON page.block_id = placement.block_id \
         WHERE block.id IS NULL \
            OR block.library_id <> placement.library_id \
            OR block.lifecycle = 'deleted' \
            OR block.type NOT IN ( \
                 'page', 'database', 'canvas', 'synced_block_source', \
                 'reusable_template_source' \
               ) \
            OR EXISTS ( \
                 SELECT 1 FROM document_block_index block_index \
                 WHERE block_index.block_id = placement.block_id \
               ) \
            OR (page.block_id IS NOT NULL AND ( \
                 page.library_id <> placement.library_id \
                 OR page.parent_kind <> 'library' \
               ))",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if placement_mismatch != 0 {
        return Err(corrupt(format!(
            "{placement_mismatch} Library placements do not identify placeable roots"
        )));
    }

    let indexed_block_mismatch = connection.query_row(
        "SELECT count(*) FROM document_block_index block_index \
         LEFT JOIN documents document ON document.id = block_index.document_id \
         LEFT JOIN blocks block ON block.id = block_index.block_id \
         LEFT JOIN pages page ON page.block_id = block_index.block_id \
         WHERE document.id IS NULL OR block.id IS NULL \
            OR document.library_id <> block.library_id \
            OR EXISTS ( \
                 SELECT 1 FROM library_block_placements placement \
                 WHERE placement.block_id = block_index.block_id \
               ) \
            OR (page.block_id IS NOT NULL AND ( \
                 page.parent_kind <> 'page' OR NOT EXISTS ( \
                   SELECT 1 FROM pages parent \
                   JOIN block_documents parent_document \
                     ON parent_document.block_id = parent.block_id \
                   WHERE parent.block_id = page.parent_id \
                     AND parent.library_id = page.library_id \
                     AND parent_document.document_id = block_index.document_id \
                     AND parent_document.library_id = page.library_id \
                 ) \
               ))",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if indexed_block_mismatch != 0 {
        return Err(corrupt(format!(
            "{indexed_block_mismatch} Document index rows disagree with Library placement"
        )));
    }

    let canvas_reference_mismatch = connection.query_row(
        "SELECT count(*) FROM canvas_page_references reference \
         LEFT JOIN blocks target ON target.id = reference.target_block_id \
         WHERE target.id IS NULL OR target.library_id <> reference.library_id",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if canvas_reference_mismatch != 0 {
        return Err(corrupt(format!(
            "{canvas_reference_mismatch} Canvas references cross a Library boundary"
        )));
    }

    let page_cycle_count = connection.query_row(
        "WITH RECURSIVE ancestry(origin_id, page_id, path, cycle) AS ( \
           SELECT page.block_id, page.block_id, '|' || page.block_id || '|', 0 \
           FROM pages page \
           UNION ALL \
           SELECT ancestry.origin_id, parent.block_id, \
             ancestry.path || parent.block_id || '|', \
             instr(ancestry.path, '|' || parent.block_id || '|') > 0 \
           FROM ancestry \
           JOIN pages child ON child.block_id = ancestry.page_id \
           JOIN pages parent ON child.parent_kind = 'page' \
             AND parent.block_id = child.parent_id \
             AND parent.library_id = child.library_id \
           WHERE ancestry.cycle = 0 \
         ) SELECT count(*) FROM ancestry WHERE cycle = 1",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if page_cycle_count != 0 {
        return Err(corrupt(format!(
            "{page_cycle_count} Page ownership paths contain a cycle"
        )));
    }

    let projection_mismatch = connection.query_row(
        "SELECT count(*) FROM page_read_model projection \
         JOIN pages page ON page.block_id = projection.page_block_id \
         JOIN blocks block ON block.id = page.block_id \
         JOIN documents document ON document.id = page.document_id \
         LEFT JOIN library_block_placements placement \
           ON placement.block_id = page.block_id AND page.parent_kind = 'library' \
         WHERE projection.library_id <> page.library_id \
            OR projection.parent_kind <> page.parent_kind \
            OR projection.parent_id <> page.parent_id \
            OR projection.lifecycle <> block.lifecycle \
            OR projection.placement_revision <> block.placement_revision \
            OR projection.metadata_revision <> block.metadata_revision \
            OR projection.document_id <> page.document_id \
            OR projection.document_generation <> document.generation \
            OR projection.document_projected_seq <> document.head_seq \
            OR projection.document_schema_version <> document.schema_version \
            OR projection.document_authority <> document.authority \
            OR (page.parent_kind = 'library' AND block.lifecycle <> 'deleted' AND ( \
                 placement.block_id IS NULL \
                 OR projection.library_rank_key <> placement.rank_key \
               )) \
            OR ((page.parent_kind <> 'library' OR block.lifecycle = 'deleted') \
                 AND projection.library_rank_key IS NOT NULL)",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if projection_mismatch != 0 {
        return Err(corrupt(format!(
            "{projection_mismatch} Page projections disagree with typed parent authority"
        )));
    }
    Ok(())
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_schema_rejects_a_project_owned_block_registry() {
        let connection = Connection::open_in_memory().expect("memory store");
        connection
            .execute_batch(
                "CREATE TABLE blocks(id TEXT PRIMARY KEY, project_id TEXT NOT NULL); \
                 CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT NOT NULL);",
            )
            .expect("legacy registry");
        let error = validate_v117_library_content_ownership(&connection)
            .expect_err("legacy content registry must fail");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
    }
}
