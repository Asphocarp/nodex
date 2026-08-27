CREATE UNIQUE INDEX idx_pages_owner_library
  ON pages(block_id, library_id);
CREATE TABLE managed_blobs (
  content_hash TEXT PRIMARY KEY,
  physical_asset_name TEXT NOT NULL UNIQUE,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  created_at TEXT NOT NULL,
  CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(physical_asset_name) BETWEEN 1 AND 255),
  CHECK (physical_asset_name NOT IN ('.', '..')),
  CHECK (physical_asset_name NOT LIKE '%/%'),
  CHECK (physical_asset_name NOT LIKE '%\%'),
  CHECK (length(created_at) > 0)
) WITHOUT ROWID, STRICT;
CREATE TABLE prepared_blob_receipts (
  receipt_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  store_epoch TEXT NOT NULL,
  content_hash TEXT NOT NULL REFERENCES managed_blobs(content_hash) ON DELETE RESTRICT,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared', 'consumed')),
  operation_id TEXT NOT NULL,
  expires_at_unix_ms INTEGER NOT NULL CHECK (expires_at_unix_ms >= 0),
  consumed_commit_seq INTEGER CHECK (consumed_commit_seq >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(receipt_id) BETWEEN 1 AND 512),
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(operation_id) BETWEEN 1 AND 512),
  CHECK (
    (state = 'prepared' AND consumed_commit_seq IS NULL)
    OR (state = 'consumed' AND consumed_commit_seq IS NOT NULL)
  )
) WITHOUT ROWID, STRICT;
CREATE TABLE page_file_manifests (
  page_id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (page_id, library_id)
    REFERENCES pages(block_id, library_id) ON UPDATE CASCADE ON DELETE CASCADE
) WITHOUT ROWID, STRICT;
CREATE TABLE page_file_versions (
  file_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  library_id TEXT NOT NULL,
  owner_page_id TEXT NOT NULL,
  manifest_revision INTEGER NOT NULL CHECK (manifest_revision >= 1),
  change_kind TEXT NOT NULL
    CHECK (change_kind IN ('create', 'replace', 'rename', 'delete', 'restore', 'clone')),
  logical_path TEXT NOT NULL,
  path_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  blob_hash TEXT REFERENCES managed_blobs(content_hash) ON DELETE RESTRICT,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  actor_id TEXT NOT NULL,
  turn_id TEXT,
  operation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (file_id, version),
  FOREIGN KEY (owner_page_id, library_id)
    REFERENCES pages(block_id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (length(file_id) BETWEEN 1 AND 512),
  CHECK (length(logical_path) BETWEEN 1 AND 1024),
  CHECK (length(path_key) BETWEEN 1 AND 1024),
  CHECK (length(mime_type) BETWEEN 1 AND 255),
  CHECK (length(actor_id) BETWEEN 1 AND 512),
  CHECK (turn_id IS NULL OR length(turn_id) BETWEEN 1 AND 512),
  CHECK (length(operation_id) BETWEEN 1 AND 512),
  CHECK (length(occurred_at) > 0),
  CHECK (
    (change_kind = 'delete' AND blob_hash IS NULL)
    OR (change_kind <> 'delete' AND blob_hash IS NOT NULL)
  )
) WITHOUT ROWID, STRICT;
CREATE TABLE page_files (
  file_id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  owner_page_id TEXT NOT NULL,
  logical_path TEXT NOT NULL,
  path_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  current_version INTEGER NOT NULL CHECK (current_version >= 1),
  state TEXT NOT NULL DEFAULT 'live' CHECK (state IN ('live', 'deleted')),
  created_by_actor_id TEXT NOT NULL,
  created_by_turn_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_page_id, library_id)
    REFERENCES pages(block_id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (length(file_id) BETWEEN 1 AND 512),
  CHECK (length(logical_path) BETWEEN 1 AND 1024),
  CHECK (length(path_key) BETWEEN 1 AND 1024),
  CHECK (length(mime_type) BETWEEN 1 AND 255),
  CHECK (length(created_by_actor_id) BETWEEN 1 AND 512),
  CHECK (created_by_turn_id IS NULL OR length(created_by_turn_id) BETWEEN 1 AND 512),
  CHECK (length(created_at) > 0),
  CHECK (length(updated_at) > 0)
) WITHOUT ROWID, STRICT;
CREATE TABLE page_file_namespace (
  owner_page_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  path_key TEXT NOT NULL,
  file_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (owner_page_id, path_key),
  FOREIGN KEY (owner_page_id, library_id)
    REFERENCES pages(block_id, library_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES page_files(file_id)
    ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CHECK (length(path_key) BETWEEN 1 AND 1024)
) WITHOUT ROWID, STRICT;
DROP TRIGGER block_asset_refs_validate_insert;
DROP TRIGGER block_asset_refs_validate_update;
DROP INDEX idx_block_asset_refs_block;
DROP INDEX idx_block_asset_refs_owner;
DROP INDEX idx_block_asset_refs_document_freshness;
DROP INDEX idx_block_asset_refs_library_uri;
ALTER TABLE block_asset_refs RENAME TO block_asset_refs_v137;
CREATE TABLE "block_asset_refs" (
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
  page_file_id TEXT REFERENCES page_files(file_id) ON DELETE RESTRICT,
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
  CHECK (
    (page_file_id IS NULL AND asset_uri NOT LIKE 'nodex://files/%')
    OR (page_file_id IS NOT NULL
      AND asset_uri = 'nodex://files/' || page_file_id
      AND asset_hash IS NOT NULL)
  ),
  CHECK (length(updated_at) > 0)
) WITHOUT ROWID, STRICT;
INSERT INTO block_asset_refs(
  document_id, block_id, owner_block_id, library_id, document_generation,
  projected_seq, projection_version, role, ordinal, asset_uri, asset_hash,
  page_file_id, updated_at
)
SELECT
  document_id, block_id, owner_block_id, library_id, document_generation,
  projected_seq, projection_version, role, ordinal, asset_uri, asset_hash,
  NULL, updated_at
FROM block_asset_refs_v137;
DROP TABLE block_asset_refs_v137;
CREATE INDEX idx_prepared_blob_receipts_expiry
  ON prepared_blob_receipts(state, expires_at_unix_ms, receipt_id);
CREATE INDEX idx_prepared_blob_receipts_blob
  ON prepared_blob_receipts(content_hash, state, receipt_id);
CREATE INDEX idx_page_file_versions_owner
  ON page_file_versions(owner_page_id, library_id, occurred_at DESC, file_id, version DESC);
CREATE INDEX idx_page_file_versions_blob
  ON page_file_versions(blob_hash, owner_page_id, file_id)
  WHERE blob_hash IS NOT NULL;
CREATE INDEX idx_page_files_owner_path
  ON page_files(owner_page_id, state, path_key, file_id);
CREATE INDEX idx_block_asset_refs_page_file
  ON block_asset_refs(page_file_id, document_id, block_id)
  WHERE page_file_id IS NOT NULL;
CREATE INDEX idx_block_asset_refs_block ON block_asset_refs(block_id, library_id);
CREATE INDEX idx_block_asset_refs_owner ON block_asset_refs(owner_block_id, library_id);
CREATE INDEX idx_block_asset_refs_document_freshness
  ON block_asset_refs(document_id, document_generation, projected_seq);
CREATE INDEX idx_block_asset_refs_library_uri
  ON block_asset_refs(library_id, asset_uri, block_id);
CREATE TRIGGER managed_blobs_are_immutable
BEFORE UPDATE ON managed_blobs
BEGIN
  SELECT RAISE(ABORT, 'Managed Blobs are immutable');
END;
CREATE TRIGGER prepared_blob_receipts_validate_insert
BEFORE INSERT ON prepared_blob_receipts
WHEN NOT EXISTS (
  SELECT 1 FROM managed_blobs blob
  WHERE blob.content_hash = NEW.content_hash AND blob.byte_length = NEW.byte_length
)
BEGIN
  SELECT RAISE(ABORT, 'Prepared Blob receipt does not match one durable Blob');
END;
CREATE TRIGGER prepared_blob_receipts_validate_update
BEFORE UPDATE ON prepared_blob_receipts
WHEN OLD.receipt_id <> NEW.receipt_id
  OR OLD.project_id <> NEW.project_id
  OR OLD.library_id <> NEW.library_id
  OR OLD.store_epoch <> NEW.store_epoch
  OR OLD.content_hash <> NEW.content_hash
  OR OLD.byte_length <> NEW.byte_length
  OR OLD.operation_id <> NEW.operation_id
  OR OLD.expires_at_unix_ms <> NEW.expires_at_unix_ms
  OR OLD.created_at <> NEW.created_at
  OR OLD.state <> 'prepared'
  OR NEW.state <> 'consumed'
  OR NEW.consumed_commit_seq IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Prepared Blob receipt transition is invalid');
END;
CREATE TRIGGER page_file_manifests_advance_one_revision
BEFORE UPDATE ON page_file_manifests
WHEN OLD.page_id <> NEW.page_id
  OR OLD.library_id <> NEW.library_id
  OR NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'Page File manifest must advance by one revision');
END;
CREATE TRIGGER pages_initialize_file_manifest
AFTER INSERT ON pages
BEGIN
  INSERT INTO page_file_manifests(page_id, library_id, revision, updated_at)
  VALUES (NEW.block_id, NEW.library_id, 0, NEW.updated_at);
END;
CREATE TRIGGER page_file_versions_validate_insert
BEFORE INSERT ON page_file_versions
WHEN NOT EXISTS (
  SELECT 1 FROM page_file_manifests manifest
  WHERE manifest.page_id = NEW.owner_page_id
    AND manifest.library_id = NEW.library_id
    AND manifest.revision = NEW.manifest_revision
) OR (
  NEW.blob_hash IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM managed_blobs blob
    WHERE blob.content_hash = NEW.blob_hash AND blob.byte_length = NEW.byte_length
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Page File version authority is invalid');
END;
CREATE TRIGGER page_file_versions_are_immutable
BEFORE UPDATE ON page_file_versions
BEGIN
  SELECT RAISE(ABORT, 'Page File versions are immutable');
END;
CREATE TRIGGER page_files_validate_insert
BEFORE INSERT ON page_files
WHEN NOT EXISTS (
  SELECT 1 FROM page_file_versions version
  WHERE version.file_id = NEW.file_id
    AND version.version = NEW.current_version
    AND version.library_id = NEW.library_id
    AND version.owner_page_id = NEW.owner_page_id
    AND version.logical_path = NEW.logical_path
    AND version.path_key = NEW.path_key
    AND version.mime_type = NEW.mime_type
    AND version.byte_length = NEW.byte_length
    AND (
      (NEW.state = 'live' AND version.change_kind <> 'delete' AND version.blob_hash IS NOT NULL)
      OR (NEW.state = 'deleted' AND version.change_kind = 'delete' AND version.blob_hash IS NULL)
    )
) OR (
  NEW.state = 'live' AND NOT EXISTS (
    SELECT 1 FROM page_file_namespace namespace
    WHERE namespace.owner_page_id = NEW.owner_page_id
      AND namespace.library_id = NEW.library_id
      AND namespace.path_key = NEW.path_key
      AND namespace.file_id = NEW.file_id
  )
) OR (
  NEW.state = 'deleted' AND EXISTS (
    SELECT 1 FROM page_file_namespace namespace WHERE namespace.file_id = NEW.file_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Page File head does not match its current version');
END;
CREATE TRIGGER page_files_validate_update
BEFORE UPDATE ON page_files
WHEN OLD.file_id <> NEW.file_id
  OR OLD.library_id <> NEW.library_id
  OR OLD.owner_page_id <> NEW.owner_page_id
  OR OLD.created_by_actor_id <> NEW.created_by_actor_id
  OR OLD.created_by_turn_id IS NOT NEW.created_by_turn_id
  OR OLD.created_at <> NEW.created_at
  OR NEW.current_version <> OLD.current_version + 1
  OR NOT EXISTS (
    SELECT 1 FROM page_file_versions version
    WHERE version.file_id = NEW.file_id
      AND version.version = NEW.current_version
      AND version.library_id = NEW.library_id
      AND version.owner_page_id = NEW.owner_page_id
      AND version.logical_path = NEW.logical_path
      AND version.path_key = NEW.path_key
      AND version.mime_type = NEW.mime_type
      AND version.byte_length = NEW.byte_length
      AND (
        (NEW.state = 'live' AND version.change_kind <> 'delete' AND version.blob_hash IS NOT NULL)
        OR (NEW.state = 'deleted' AND version.change_kind = 'delete' AND version.blob_hash IS NULL)
      )
  )
  OR (
    NEW.state = 'live' AND NOT EXISTS (
      SELECT 1 FROM page_file_namespace namespace
      WHERE namespace.owner_page_id = NEW.owner_page_id
        AND namespace.library_id = NEW.library_id
        AND namespace.path_key = NEW.path_key
        AND namespace.file_id = NEW.file_id
    )
  )
  OR (
    NEW.state = 'deleted' AND EXISTS (
      SELECT 1 FROM page_file_namespace namespace WHERE namespace.file_id = NEW.file_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Page File head transition is invalid');
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
) OR (
  NEW.page_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM page_files file
    JOIN page_file_versions version
      ON version.file_id = file.file_id AND version.version = file.current_version
    WHERE file.file_id = NEW.page_file_id
      AND file.library_id = NEW.library_id
      AND file.owner_page_id = NEW.owner_block_id
      AND file.state = 'live'
      AND version.blob_hash = NEW.asset_hash
  )
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
) OR (
  NEW.page_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM page_files file
    JOIN page_file_versions version
      ON version.file_id = file.file_id AND version.version = file.current_version
    WHERE file.file_id = NEW.page_file_id
      AND file.library_id = NEW.library_id
      AND file.owner_page_id = NEW.owner_block_id
      AND file.state = 'live'
      AND version.blob_hash = NEW.asset_hash
  )
) BEGIN
  SELECT RAISE(ABORT, 'Block asset projection source is invalid or from the future');
END;
