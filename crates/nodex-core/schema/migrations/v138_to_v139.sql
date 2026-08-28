ALTER TABLE page_file_manifests
  ADD COLUMN body_usage_revision INTEGER NOT NULL DEFAULT 0
  CHECK (body_usage_revision >= 0);

DROP TRIGGER page_file_manifests_advance_one_revision;
CREATE TRIGGER page_file_manifests_advance_one_revision
BEFORE UPDATE ON page_file_manifests
WHEN OLD.page_id <> NEW.page_id
  OR OLD.library_id <> NEW.library_id
  OR NOT (
    (NEW.revision = OLD.revision + 1
      AND NEW.body_usage_revision = OLD.body_usage_revision)
    OR (NEW.revision = OLD.revision
      AND NEW.body_usage_revision = OLD.body_usage_revision + 1)
  )
BEGIN
  SELECT RAISE(ABORT, 'Page File manifest or body usage must advance by one revision');
END;

DROP TRIGGER pages_initialize_file_manifest;
CREATE TRIGGER pages_initialize_file_manifest
AFTER INSERT ON pages
BEGIN
  INSERT INTO page_file_manifests(
    page_id, library_id, revision, body_usage_revision, updated_at
  ) VALUES (NEW.block_id, NEW.library_id, 0, 0, NEW.updated_at);
END;
