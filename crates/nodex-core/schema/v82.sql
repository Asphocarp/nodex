-- Generated from the TypeScript-authoritative Nodex v82 schema.
-- Regenerate with: pnpm core:schema:v82:generate
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    , library_id TEXT, database_block_id TEXT, lifecycle TEXT NOT NULL DEFAULT 'active', binding_revision INTEGER NOT NULL DEFAULT 1);

CREATE TABLE project_sources (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      root TEXT NOT NULL,
      root_key TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      PRIMARY KEY (project_id, root_key)
    );

CREATE TABLE project_order (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL,
      updated TEXT NOT NULL
    );

CREATE TABLE pinned_project_order (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL,
      updated TEXT NOT NULL
    );

CREATE TABLE codex_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      parent_thread_id TEXT,
      thread_name TEXT,
      thread_source TEXT,
      agent_nickname TEXT,
      agent_role TEXT,
      thread_preview TEXT NOT NULL DEFAULT '',
      model_provider TEXT NOT NULL DEFAULT '',
      cwd TEXT,
      managed_worktree_path TEXT,
      projectless_output_directory TEXT,
      projectless_workspace_browser_root TEXT,
      status_type TEXT NOT NULL DEFAULT 'notLoaded',
      status_active_flags_json TEXT NOT NULL DEFAULT '[]',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      linked_at TEXT NOT NULL
    , forked_from_id TEXT, service_name TEXT) WITHOUT ROWID;

CREATE TABLE codex_thread_dynamic_tool_catalogs (
      thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      namespace TEXT NOT NULL,
      toolset_revision INTEGER NOT NULL,
      PRIMARY KEY (thread_id, namespace),
      CHECK (length(trim(namespace)) > 0),
      CHECK (toolset_revision > 0)
    ) WITHOUT ROWID;

CREATE TABLE codex_project_permission_mode_selections (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (mode IN ('auto', 'guardian-approvals', 'full-access', 'custom'))
    ) WITHOUT ROWID;

CREATE TABLE nodex_agent_token_keys (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      key_material BLOB NOT NULL CHECK (length(key_material) = 32)
    );

CREATE TABLE nodex_agent_call_receipts (
      call_identity TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      call_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      tool TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      mutation_id TEXT NOT NULL UNIQUE,
      authority_fingerprint TEXT,
      provenance_version INTEGER,
      allocations_json TEXT NOT NULL DEFAULT '[]',
      result_metadata_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'prepared',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (thread_id, call_id),
      CHECK (length(call_identity) = 64),
      CHECK (length(trim(thread_id)) BETWEEN 1 AND 512),
      CHECK (turn_id IS NULL OR length(trim(turn_id)) BETWEEN 1 AND 512),
      CHECK (length(trim(call_id)) BETWEEN 1 AND 512),
      CHECK (length(trim(tool)) BETWEEN 1 AND 128),
      CHECK (length(request_hash) = 64),
      CHECK (length(trim(mutation_id)) BETWEEN 1 AND 512),
      CHECK (
        (turn_id IS NULL AND authority_fingerprint IS NULL AND provenance_version IS NULL)
        OR (
          turn_id IS NOT NULL
          AND authority_fingerprint IS NOT NULL
          AND provenance_version IS NOT NULL
          AND
          length(trim(turn_id)) BETWEEN 1 AND 512
          AND length(authority_fingerprint) = 64
          AND provenance_version = 1
        )
      ),
      CHECK (json_valid(allocations_json) AND json_type(allocations_json) = 'array'),
      CHECK (json_valid(result_metadata_json) AND json_type(result_metadata_json) = 'object'),
      CHECK (status IN ('prepared', 'committed'))
    ) WITHOUT ROWID;

CREATE TABLE nodex_agent_turn_authorities (
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      root_thread_id TEXT NOT NULL,
      actor_project_id TEXT NOT NULL,
      library_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      store_epoch TEXT NOT NULL,
      scope TEXT NOT NULL,
      source TEXT NOT NULL,
      permission_profile_id TEXT,
      authority_fingerprint TEXT NOT NULL,
      provenance_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, turn_id),
      CHECK (length(trim(thread_id)) BETWEEN 1 AND 512),
      CHECK (length(trim(turn_id)) BETWEEN 1 AND 512),
      CHECK (length(trim(root_thread_id)) BETWEEN 1 AND 512),
      CHECK (length(trim(actor_project_id)) BETWEEN 1 AND 512),
      CHECK (length(trim(library_id)) BETWEEN 1 AND 512),
      CHECK (length(trim(profile_id)) BETWEEN 1 AND 512),
      CHECK (length(trim(store_epoch)) BETWEEN 1 AND 512),
      CHECK (scope IN ('project', 'library')),
      CHECK (source IN (
        'project_turn',
        'builtin_full_access',
        'inherited_builtin_full_access'
      )),
      CHECK (
        (scope = 'library' AND permission_profile_id = ':danger-full-access')
        OR (scope = 'project' AND permission_profile_id IS NULL)
      ),
      CHECK (length(authority_fingerprint) = 64),
      CHECK (provenance_version = 1)
    ) WITHOUT ROWID;

CREATE TABLE library_content_relocations (
      operation_id TEXT PRIMARY KEY,
      call_identity TEXT NOT NULL,
      actor_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      source_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      target_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
      store_epoch TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      root_page_ids_json TEXT NOT NULL,
      block_ids_json TEXT NOT NULL,
      document_ids_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'committed',
      committed_at TEXT NOT NULL,
      CHECK (length(trim(operation_id)) BETWEEN 1 AND 512),
      CHECK (length(call_identity) = 64),
      CHECK (length(trim(store_epoch)) BETWEEN 1 AND 512),
      CHECK (length(request_hash) = 64),
      CHECK (json_valid(root_page_ids_json) AND json_type(root_page_ids_json) = 'array'),
      CHECK (json_valid(block_ids_json) AND json_type(block_ids_json) = 'array'),
      CHECK (json_valid(document_ids_json) AND json_type(document_ids_json) = 'array'),
      CHECK (status = 'committed')
    ) WITHOUT ROWID;

CREATE TABLE library_content_relocation_members (
      operation_id TEXT NOT NULL REFERENCES library_content_relocations(operation_id)
        ON DELETE RESTRICT,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      source_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      final_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      PRIMARY KEY (operation_id, resource_kind, resource_id),
      CHECK (resource_kind IN ('block', 'document')),
      CHECK (length(trim(resource_id)) BETWEEN 1 AND 512)
    ) WITHOUT ROWID;

CREATE TABLE codex_scheduled_automations (
	      automation_id TEXT PRIMARY KEY,
	      kind TEXT NOT NULL,
	      status TEXT NOT NULL,
	      target_thread_id TEXT,
	      name TEXT NOT NULL,
	      prompt TEXT NOT NULL DEFAULT '',
	      rrule TEXT,
	      model TEXT,
	      reasoning_effort TEXT,
	      cwds_json TEXT NOT NULL DEFAULT '[]',
	      execution_environment TEXT NOT NULL DEFAULT 'worktree',
	      local_environment_config_path TEXT,
	      next_run_at INTEGER,
	      last_run_at INTEGER,
	      created_at INTEGER NOT NULL,
	      updated_at INTEGER NOT NULL,
	      CHECK (kind IN ('cron', 'heartbeat')),
	      CHECK (status IN ('ACTIVE', 'PAUSED', 'DELETED')),
	      CHECK (execution_environment IN ('local', 'worktree')),
	      CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'))
	    ) WITHOUT ROWID;

CREATE TABLE codex_automation_runs (
	      thread_id TEXT PRIMARY KEY,
	      automation_id TEXT NOT NULL,
	      status TEXT NOT NULL,
	      read_at INTEGER,
	      thread_title TEXT,
	      source_cwd TEXT,
	      inbox_title TEXT,
	      inbox_summary TEXT,
	      archived_user_message TEXT,
	      archived_assistant_message TEXT,
	      archived_reason TEXT,
	      created_at INTEGER NOT NULL,
	      updated_at INTEGER NOT NULL,
	      CHECK (status IN ('IN_PROGRESS', 'PENDING_REVIEW', 'ACCEPTED', 'ARCHIVED'))
	    ) WITHOUT ROWID;

CREATE TABLE codex_background_processes (
      process_record_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      thread_title TEXT,
      item_id TEXT NOT NULL,
      turn_id TEXT,
      command TEXT NOT NULL,
      cwd TEXT,
      app_server_process_id TEXT,
      os_pid INTEGER,
      terminal_session_id TEXT,
      source TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      CHECK (source IN ('app-server', 'terminal-action'))
    ) WITHOUT ROWID;

CREATE TABLE project_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      no_thread_fallback_title TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      pinned_order INTEGER,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      unread INTEGER NOT NULL DEFAULT 0,
      left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
      panel_state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (pinned IN (0, 1)),
      CHECK (archived IN (0, 1)),
      CHECK (unread IN (0, 1)),
      CHECK (left_pane_collapsed IN (0, 1))
    );

CREATE TABLE project_session_threads (
      session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      linked_at TEXT NOT NULL
    ) WITHOUT ROWID;

CREATE TABLE codex_pinned_threads (
      thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      pinned_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) WITHOUT ROWID;

CREATE TABLE thread_search_units (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_key TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      session_id TEXT REFERENCES project_sessions(id) ON DELETE SET NULL,
      turn_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      source_updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      CHECK (role IN ('user', 'assistant'))
    );

CREATE TABLE thread_search_thread_state (
      thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      source_updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      index_version INTEGER NOT NULL DEFAULT 1,
      unit_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_error TEXT,
      failed_at INTEGER,
      retry_after INTEGER,
      CHECK (status IN ('ready', 'stale', 'failed'))
    ) WITHOUT ROWID;

CREATE VIRTUAL TABLE thread_search_units_fts USING fts5(
      text,
      content='thread_search_units',
      content_rowid='rowid',
      tokenize="unicode61 remove_diacritics 2 tokenchars '-_/@.:#'",
      prefix='2 3 4'
    );

CREATE TABLE block_store_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      store_epoch TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE block_properties (
      block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      property_key TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (block_id, property_key),
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
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
    ) WITHOUT ROWID;

CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
      updated_at TEXT NOT NULL, sync_engine TEXT NOT NULL DEFAULT 'yjs' CHECK (sync_engine IN ('yjs', 'canvas_scene')),
      UNIQUE (id, project_id),
      CHECK (readiness IN ('pending_genesis', 'ready', 'failed')),
      CHECK (authority IN ('legacy_shadow', 'ydoc_primary')),
      CHECK (authority <> 'ydoc_primary' OR readiness = 'ready')
    );

CREATE TABLE top_level_block_placements (
      block_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      rank_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON DELETE CASCADE
    ) WITHOUT ROWID;

CREATE TABLE block_documents (
      block_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON DELETE RESTRICT,
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON DELETE RESTRICT
    ) WITHOUT ROWID;

CREATE TABLE document_updates (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      seq INTEGER NOT NULL CHECK (seq >= 1),
      update_id TEXT NOT NULL,
      client_session_id TEXT NOT NULL,
      base_head_seq INTEGER NOT NULL CHECK (base_head_seq >= 0),
      touched_block_ids_json TEXT NOT NULL DEFAULT '[]',
      update_blob BLOB NOT NULL,
      update_hash TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      PRIMARY KEY (document_id, generation, seq),
      UNIQUE (document_id, update_id)
    ) WITHOUT ROWID;

CREATE TABLE document_snapshots (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      snapshot_seq INTEGER NOT NULL CHECK (snapshot_seq >= 0),
      state_vector BLOB NOT NULL,
      snapshot_update BLOB NOT NULL,
      snapshot_hash TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
      created_at TEXT NOT NULL,
      PRIMARY KEY (document_id, generation, snapshot_seq)
    ) WITHOUT ROWID;

CREATE TABLE document_materializations (
      document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
      schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
      title TEXT NOT NULL DEFAULT '',
      title_rich_json TEXT NOT NULL DEFAULT '[]',
      title_rich_hash TEXT NOT NULL DEFAULT '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
      nfm TEXT NOT NULL,
      plain_text TEXT NOT NULL,
      preview TEXT NOT NULL,
      block_tree_json TEXT NOT NULL,
      references_json TEXT NOT NULL DEFAULT '[]',
      asset_refs_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      CHECK (json_valid(block_tree_json) AND json_type(block_tree_json) = 'array'),
      CHECK (json_valid(title_rich_json) AND json_type(title_rich_json) = 'array'),
      CHECK (length(title_rich_hash) = 64),
      CHECK (json_valid(references_json) AND json_type(references_json) = 'array'),
      CHECK (json_valid(asset_refs_json) AND json_type(asset_refs_json) = 'array')
    ) WITHOUT ROWID;

CREATE TABLE document_block_index (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL UNIQUE REFERENCES blocks(id) ON DELETE CASCADE,
      parent_block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      block_type TEXT NOT NULL,
      text TEXT NOT NULL,
      projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
      PRIMARY KEY (document_id, block_id)
    ) WITHOUT ROWID;

CREATE TABLE "scheduled_page_index" (
      "page_block_id" TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      scheduled_start TEXT,
      scheduled_end TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
      recurrence_json TEXT NOT NULL DEFAULT 'null',
      reminders_json TEXT NOT NULL DEFAULT '[]',
      schedule_timezone TEXT,
      source_metadata_revision INTEGER NOT NULL CHECK (source_metadata_revision >= 1),
      updated_at TEXT NOT NULL,
      FOREIGN KEY ("page_block_id", project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (lifecycle IN ('active', 'archived', 'deleted')),
      CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end > scheduled_start),
      CHECK (is_all_day = 0 OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL)),
      CHECK (
        json_valid(recurrence_json)
        AND json_type(recurrence_json) IN ('null', 'object')
      ),
      CHECK (
        json_valid(reminders_json)
        AND json_type(reminders_json) = 'array'
      )
    ) WITHOUT ROWID;

CREATE TABLE document_update_receipts (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      seq INTEGER NOT NULL CHECK (seq >= 1),
      update_id TEXT NOT NULL,
      client_session_id TEXT NOT NULL,
      base_head_seq INTEGER NOT NULL CHECK (base_head_seq >= 0),
      client_touched_block_ids_json TEXT NOT NULL DEFAULT '[]',
      derived_touched_block_ids_json TEXT NOT NULL DEFAULT '[]',
      derivation_version INTEGER NOT NULL DEFAULT 1 CHECK (derivation_version IN (0, 1)),
      update_hash TEXT NOT NULL,
      update_byte_length INTEGER NOT NULL CHECK (update_byte_length > 0),
      committed_at TEXT NOT NULL,
      PRIMARY KEY (document_id, generation, seq),
      UNIQUE (document_id, update_id)
    ) WITHOUT ROWID;

CREATE TABLE retired_block_identities (
      block_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      block_type TEXT NOT NULL,
      retention_root_block_id TEXT NOT NULL,
      retired_at TEXT NOT NULL,
      CHECK (length(block_id) BETWEEN 1 AND 512 AND block_id = trim(block_id)),
      CHECK (length(project_id) BETWEEN 1 AND 512 AND project_id = trim(project_id)),
      CHECK (length(block_type) BETWEEN 1 AND 512 AND block_type = trim(block_type)),
      CHECK (
        length(retention_root_block_id) BETWEEN 1 AND 512
        AND retention_root_block_id = trim(retention_root_block_id)
      ),
      CHECK (length(retired_at) > 0)
    ) WITHOUT ROWID;

CREATE TABLE recurrence_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      "page_id" TEXT NOT NULL,
      occurrence_start TEXT NOT NULL,
      exception_type TEXT NOT NULL,
      override_start TEXT,
      override_end TEXT,
      override_reminders_json TEXT,
      created TEXT NOT NULL,
      FOREIGN KEY ("page_id", project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (exception_type IN ('skip', 'override_time'))
    );

CREATE TABLE reminder_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      "page_id" TEXT NOT NULL,
      occurrence_start TEXT NOT NULL,
      reminder_offset_minutes INTEGER NOT NULL,
      delivered_at TEXT NOT NULL,
      FOREIGN KEY ("page_id", project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE
    );

CREATE TABLE change_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      store_epoch TEXT NOT NULL,
      kind TEXT NOT NULL,
      operation_id TEXT,
      block_ids_json TEXT NOT NULL DEFAULT '[]',
      document_ids_json TEXT NOT NULL DEFAULT '[]',
      database_block_ids_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT NOT NULL DEFAULT '{}',
      committed_at TEXT NOT NULL,
      CHECK (length(store_epoch) BETWEEN 1 AND 512),
      CHECK (length(kind) BETWEEN 1 AND 128),
      CHECK (operation_id IS NULL OR length(operation_id) BETWEEN 1 AND 512),
      CHECK (json_valid(block_ids_json) AND json_type(block_ids_json) = 'array'),
      CHECK (json_valid(document_ids_json) AND json_type(document_ids_json) = 'array'),
      CHECK (
        json_valid(database_block_ids_json)
        AND json_type(database_block_ids_json) = 'array'
      ),
      CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
      CHECK (length(committed_at) > 0)
    );

CREATE TABLE block_relocations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      target_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
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
      expected_location_revisions_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'committed',
      source_update_id TEXT NOT NULL,
      source_committed_seq INTEGER NOT NULL CHECK (source_committed_seq >= 1),
      target_update_id TEXT,
      target_committed_seq INTEGER,
      final_location_revisions_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      change_log_seq INTEGER NOT NULL UNIQUE
        REFERENCES change_log(seq) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      committed_at TEXT NOT NULL,
      UNIQUE (id, project_id),
      UNIQUE (
        id, source_document_id, project_id, source_generation,
        source_base_head_seq
      ),
      FOREIGN KEY (source_document_id)
        REFERENCES documents(id) ON DELETE RESTRICT,
      FOREIGN KEY (target_document_id)
        REFERENCES documents(id) ON DELETE RESTRICT,
      FOREIGN KEY (target_parent_block_id)
        REFERENCES blocks(id) ON DELETE RESTRICT,
      FOREIGN KEY (target_before_block_id)
        REFERENCES blocks(id) ON DELETE RESTRICT,
      FOREIGN KEY (source_document_id, source_generation, source_committed_seq)
        REFERENCES document_update_receipts(document_id, generation, seq)
        ON DELETE RESTRICT,
      FOREIGN KEY (target_document_id, target_generation, target_committed_seq)
        REFERENCES document_update_receipts(document_id, generation, seq)
        ON DELETE RESTRICT,
      CHECK (length(id) BETWEEN 1 AND 512),
      CHECK (length(store_epoch) BETWEEN 1 AND 512),
      CHECK (
        length(request_hash) = 64
        AND request_hash NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
      CHECK (
        json_valid(root_block_ids_json)
        AND json_type(root_block_ids_json) = 'array'
        AND json_array_length(root_block_ids_json) > 0
      ),
      CHECK (
        json_valid(expected_location_revisions_json)
        AND json_type(expected_location_revisions_json) = 'object'
      ),
      CHECK (
        json_valid(final_location_revisions_json)
        AND json_type(final_location_revisions_json) = 'object'
      ),
      CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
      CHECK (status = 'committed'),
      CHECK (target_kind IN ('document', 'space')),
      CHECK (
        (target_kind = 'document'
          AND target_project_id = project_id
          AND target_document_id IS NOT NULL
          AND target_document_id <> source_document_id
          AND target_generation IS NOT NULL
          AND target_generation >= 1
          AND target_base_head_seq IS NOT NULL
          AND target_base_head_seq >= 0
          AND target_update_id IS NOT NULL
          AND target_committed_seq = target_base_head_seq + 1)
        OR (target_kind = 'space'
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
    );

CREATE TABLE block_relocation_members (
      relocation_id TEXT NOT NULL,
      block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE RESTRICT,
      tree_ordinal INTEGER NOT NULL CHECK (tree_ordinal >= 0),
      is_root INTEGER NOT NULL CHECK (is_root IN (0, 1)),
      source_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      final_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      source_location_revision INTEGER NOT NULL CHECK (source_location_revision >= 1),
      final_location_revision INTEGER NOT NULL CHECK (final_location_revision >= 2),
      PRIMARY KEY (relocation_id, block_id),
      UNIQUE (relocation_id, tree_ordinal),
      FOREIGN KEY (relocation_id, source_project_id)
        REFERENCES block_relocations(id, project_id) ON DELETE CASCADE,
      CHECK (final_location_revision = source_location_revision + 1)
    ) WITHOUT ROWID;

CREATE TABLE block_relocation_source_states (
      relocation_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      head_seq INTEGER NOT NULL CHECK (head_seq >= 0),
      pre_state_vector BLOB NOT NULL,
      pre_full_update BLOB NOT NULL,
      pre_full_update_byte_length INTEGER NOT NULL
        CHECK (pre_full_update_byte_length > 0),
      pre_state_hash TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      FOREIGN KEY (
        relocation_id, document_id, project_id, generation, head_seq
      ) REFERENCES block_relocations(
        id, source_document_id, project_id, source_generation,
        source_base_head_seq
      ) ON DELETE CASCADE,
      CHECK (length(pre_state_vector) > 0),
      CHECK (length(pre_full_update) = pre_full_update_byte_length),
      CHECK (
        length(pre_state_hash) = 64
        AND pre_state_hash NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK (length(captured_at) > 0)
    ) WITHOUT ROWID;

CREATE TABLE document_recovery_artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      store_epoch TEXT NOT NULL,
      document_id TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      update_id TEXT NOT NULL,
      client_session_id TEXT NOT NULL,
      base_head_seq INTEGER NOT NULL CHECK (base_head_seq >= 0),
      touched_block_ids_json TEXT NOT NULL DEFAULT '[]',
      derived_touched_block_ids_json TEXT,
      update_blob BLOB NOT NULL,
      update_hash TEXT NOT NULL,
      update_byte_length INTEGER NOT NULL CHECK (update_byte_length > 0),
      reason TEXT NOT NULL,
      relocation_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      resolved_at TEXT,
      UNIQUE (document_id, generation, update_id),
      FOREIGN KEY (document_id)
        REFERENCES documents(id) ON DELETE RESTRICT,
      CHECK (length(id) BETWEEN 1 AND 512),
      CHECK (length(store_epoch) BETWEEN 1 AND 512),
      CHECK (length(update_id) BETWEEN 1 AND 512),
      CHECK (length(client_session_id) BETWEEN 1 AND 512),
      CHECK (
        json_valid(touched_block_ids_json)
        AND json_type(touched_block_ids_json) = 'array'
      ),
      CHECK (
        derived_touched_block_ids_json IS NULL
        OR (json_valid(derived_touched_block_ids_json)
          AND json_type(derived_touched_block_ids_json) = 'array')
      ),
      CHECK (
        json_valid(relocation_ids_json)
        AND json_type(relocation_ids_json) = 'array'
      ),
      CHECK (length(update_blob) = update_byte_length),
      CHECK (
        length(update_hash) = 64
        AND update_hash NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK (reason IN ('block_relocated', 'unsafe_stale_update')),
      CHECK (status IN ('pending', 'resolved', 'discarded')),
      CHECK (length(created_at) > 0),
      CHECK (length(expires_at) > 0 AND expires_at > created_at),
      CHECK (
        (status = 'pending' AND resolved_at IS NULL)
        OR (status IN ('resolved', 'discarded') AND resolved_at IS NOT NULL)
      )
    ) WITHOUT ROWID;

CREATE TABLE document_versions (
      version_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      base_head_seq INTEGER NOT NULL CHECK (base_head_seq >= 0),
      schema_key TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
      cause TEXT NOT NULL,
      label TEXT,
      actor_json TEXT NOT NULL DEFAULT '{}',
      revision_kind TEXT NOT NULL DEFAULT 'manual',
      source_mutation_id TEXT,
      source_change_seq INTEGER,
      pinned INTEGER NOT NULL DEFAULT 1,
      checkpoint_format TEXT NOT NULL DEFAULT 'yjs_update_v1',
      full_update_blob BLOB NOT NULL,
      state_vector BLOB NOT NULL,
      checkpoint_hash TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id)
        REFERENCES documents(id) ON DELETE CASCADE,
      CHECK (length(version_id) BETWEEN 1 AND 512),
      CHECK (length(schema_key) BETWEEN 1 AND 128),
      CHECK (length(cause) BETWEEN 1 AND 128),
      CHECK (label IS NULL OR length(label) <= 512),
      CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
      CHECK (revision_kind IN ('automatic', 'manual', 'operation', 'restore', 'safety')),
      CHECK (source_mutation_id IS NULL OR length(trim(source_mutation_id)) BETWEEN 1 AND 512),
      CHECK (source_change_seq IS NULL OR source_change_seq >= 1),
      CHECK (pinned IN (0, 1)),
      CHECK (checkpoint_format IN ('yjs_update_v1', 'block_tree_snapshot_v2', 'canvas_scene_json_v1')),
      CHECK (
        checkpoint_format NOT IN ('block_tree_snapshot_v2', 'canvas_scene_json_v1')
        OR (
          length(state_vector) = 0
          AND json_valid(CAST(full_update_blob AS TEXT))
          AND json_type(CAST(full_update_blob AS TEXT)) = 'object'
        )
      ),
      CHECK (byte_length = length(full_update_blob)),
      CHECK (
        length(checkpoint_hash) = 64
        AND checkpoint_hash NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK (length(created_at) > 0)
    ) WITHOUT ROWID;

CREATE TABLE document_revision_sessions (
      document_id TEXT PRIMARY KEY,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      dirty_head_seq INTEGER NOT NULL CHECK (dirty_head_seq >= 0),
      burst_started_at TEXT NOT NULL,
      last_edit_at TEXT NOT NULL,
      last_checkpoint_at TEXT,
      client_session_id TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CHECK (length(burst_started_at) > 0),
      CHECK (length(last_edit_at) > 0),
      CHECK (last_checkpoint_at IS NULL OR length(last_checkpoint_at) > 0),
      CHECK (length(trim(client_session_id)) BETWEEN 1 AND 512)
    ) WITHOUT ROWID;

CREATE TABLE block_mutations (
      mutation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      store_epoch TEXT NOT NULL,
      mutation_kind TEXT NOT NULL,
      actor_json TEXT NOT NULL DEFAULT '{}',
      client_session_id TEXT,
      request_hash TEXT NOT NULL,
      request_json TEXT NOT NULL,
      target_block_ids_json TEXT NOT NULL DEFAULT '[]',
      affected_document_ids_json TEXT NOT NULL DEFAULT '[]',
      affected_database_block_ids_json TEXT NOT NULL DEFAULT '[]',
      field_intents_json TEXT NOT NULL DEFAULT '[]',
      expected_revisions_json TEXT NOT NULL DEFAULT '{}',
      outcome TEXT NOT NULL,
      result_json TEXT NOT NULL,
      committed_revisions_json TEXT NOT NULL DEFAULT '{}',
      document_heads_json TEXT NOT NULL DEFAULT '{}',
      change_log_seq INTEGER UNIQUE
        REFERENCES change_log(seq) ON DELETE RESTRICT,
      recorded_at TEXT NOT NULL,
      CHECK (length(mutation_id) BETWEEN 1 AND 512),
      CHECK (length(store_epoch) BETWEEN 1 AND 512),
      CHECK (length(mutation_kind) BETWEEN 1 AND 128),
      CHECK (client_session_id IS NULL OR length(client_session_id) BETWEEN 1 AND 512),
      CHECK (
        length(request_hash) = 64
        AND request_hash NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
      CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
      CHECK (
        json_valid(target_block_ids_json)
        AND json_type(target_block_ids_json) = 'array'
      ),
      CHECK (
        json_valid(affected_document_ids_json)
        AND json_type(affected_document_ids_json) = 'array'
      ),
      CHECK (
        json_valid(affected_database_block_ids_json)
        AND json_type(affected_database_block_ids_json) = 'array'
      ),
      CHECK (
        json_valid(field_intents_json)
        AND json_type(field_intents_json) = 'array'
      ),
      CHECK (
        json_valid(expected_revisions_json)
        AND json_type(expected_revisions_json) = 'object'
      ),
      CHECK (outcome IN ('committed', 'rejected')),
      CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
      CHECK (
        json_valid(committed_revisions_json)
        AND json_type(committed_revisions_json) = 'object'
      ),
      CHECK (
        json_valid(document_heads_json)
        AND json_type(document_heads_json) = 'object'
      ),
      CHECK (
        (outcome = 'committed' AND change_log_seq IS NOT NULL)
        OR (outcome = 'rejected' AND change_log_seq IS NULL)
      ),
      CHECK (length(recorded_at) > 0)
    ) WITHOUT ROWID;

CREATE TABLE block_search_units (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_key TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL,
      owner_block_id TEXT NOT NULL,
      document_id TEXT,
      document_generation INTEGER,
      projected_seq INTEGER,
      source_revision INTEGER,
      projection_version INTEGER NOT NULL DEFAULT 1
        CHECK (projection_version >= 1),
      source_kind TEXT NOT NULL,
      field_key TEXT NOT NULL,
      text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (owner_block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
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
    );

CREATE VIRTUAL TABLE block_search_units_fts USING fts5(
      text,
      content='block_search_units',
      content_rowid='rowid',
      tokenize="unicode61 remove_diacritics 2 tokenchars '-_/@.:#'",
      prefix='2 3 4'
    );

CREATE TABLE block_asset_refs (
      document_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      owner_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      document_generation INTEGER NOT NULL CHECK (document_generation >= 1),
      projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
      projection_version INTEGER NOT NULL DEFAULT 1
        CHECK (projection_version >= 1),
      role TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      asset_uri TEXT NOT NULL,
      asset_hash TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (document_id, block_id, role, ordinal),
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (owner_block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (length(role) BETWEEN 1 AND 128),
      CHECK (length(asset_uri) BETWEEN 1 AND 4096),
      CHECK (
        asset_hash IS NULL OR (
          length(asset_hash) = 64
          AND asset_hash NOT GLOB '*[^0-9a-f]*'
        )
      ),
      CHECK (length(updated_at) > 0)
    ) WITHOUT ROWID;

CREATE TABLE canvas_scene_file_refs (
      document_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      owner_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      document_generation INTEGER NOT NULL CHECK (document_generation >= 1),
      projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
      mime_type TEXT NOT NULL,
      asset_uri TEXT NOT NULL,
      managed_file_name TEXT NOT NULL,
      asset_hash TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (document_id, file_id),
      FOREIGN KEY (owner_block_id, document_id, project_id)
        REFERENCES block_documents(block_id, document_id, project_id)
        ON DELETE CASCADE,
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON DELETE CASCADE,
      CHECK (length(file_id) BETWEEN 1 AND 512),
      CHECK (length(mime_type) BETWEEN 1 AND 256),
      CHECK (length(asset_uri) BETWEEN 1 AND 4096),
      CHECK (length(managed_file_name) BETWEEN 1 AND 512),
      CHECK (length(asset_hash) = 64 AND asset_hash NOT GLOB '*[^0-9a-f]*')
    ) WITHOUT ROWID;

CREATE TABLE "canvas_page_references" (
      document_id TEXT NOT NULL,
      source_element_id TEXT NOT NULL,
      target_block_id TEXT NOT NULL,
      owner_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      document_generation INTEGER NOT NULL CHECK (document_generation >= 1),
      projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
      title_hint TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (document_id, source_element_id),
      FOREIGN KEY (target_block_id)
        REFERENCES blocks(id) ON DELETE RESTRICT,
      FOREIGN KEY (owner_block_id, document_id, project_id)
        REFERENCES block_documents(block_id, document_id, project_id)
        ON DELETE CASCADE,
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON DELETE CASCADE,
      CHECK (length(source_element_id) BETWEEN 1 AND 512),
      CHECK (title_hint IS NULL OR length(title_hint) <= 512)
    ) WITHOUT ROWID;

CREATE TABLE canvas_scenes (
      document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      head_seq INTEGER NOT NULL CHECK (head_seq >= 0),
      schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
      app_state_json TEXT NOT NULL DEFAULT '{}',
      scene_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (json_valid(app_state_json) AND json_type(app_state_json) = 'object'),
      CHECK (
        length(scene_hash) = 64
        AND scene_hash NOT GLOB '*[^0-9a-f]*'
      )
    ) WITHOUT ROWID;

CREATE TABLE canvas_scene_elements (
      document_id TEXT NOT NULL REFERENCES canvas_scenes(document_id) ON DELETE CASCADE,
      element_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      version_nonce INTEGER NOT NULL CHECK (version_nonce >= 0),
      order_key TEXT NOT NULL,
      is_deleted INTEGER NOT NULL CHECK (is_deleted IN (0, 1)),
      element_json TEXT NOT NULL,
      element_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (document_id, element_id),
      CHECK (length(element_id) BETWEEN 1 AND 512),
      CHECK (length(order_key) BETWEEN 1 AND 256),
      CHECK (json_valid(element_json) AND json_type(element_json) = 'object'),
      CHECK (
        length(element_hash) = 64
        AND element_hash NOT GLOB '*[^0-9a-f]*'
      )
    ) WITHOUT ROWID;

CREATE TABLE canvas_scene_files (
      document_id TEXT NOT NULL REFERENCES canvas_scenes(document_id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      asset_uri TEXT NOT NULL,
      created_ms INTEGER CHECK (created_ms IS NULL OR created_ms >= 0),
      file_json TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (document_id, file_id),
      CHECK (length(file_id) BETWEEN 1 AND 512),
      CHECK (length(mime_type) BETWEEN 1 AND 256),
      CHECK (length(asset_uri) BETWEEN 1 AND 4096),
      CHECK (json_valid(file_json) AND json_type(file_json) = 'object'),
      CHECK (
        length(file_hash) = 64
        AND file_hash NOT GLOB '*[^0-9a-f]*'
      )
    ) WITHOUT ROWID;

CREATE TABLE canvas_scene_mutation_receipts (
      document_id TEXT NOT NULL REFERENCES canvas_scenes(document_id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      mutation_id TEXT NOT NULL,
      client_session_id TEXT NOT NULL,
      base_head_seq INTEGER NOT NULL CHECK (base_head_seq >= 0),
      committed_head_seq INTEGER NOT NULL CHECK (committed_head_seq >= 0),
      request_hash TEXT NOT NULL,
      request_byte_length INTEGER NOT NULL CHECK (request_byte_length > 0),
      request_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      result_hash TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('committed', 'no_change')),
      committed_at TEXT NOT NULL,
      PRIMARY KEY (document_id, generation, mutation_id),
      UNIQUE (document_id, mutation_id),
      CHECK (length(mutation_id) BETWEEN 1 AND 512),
      CHECK (length(client_session_id) BETWEEN 1 AND 512),
      CHECK (
        length(request_hash) = 64
        AND request_hash NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK (request_byte_length = length(CAST(request_json AS BLOB))),
      CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
      CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
      CHECK (
        length(result_hash) = 64
        AND result_hash NOT GLOB '*[^0-9a-f]*'
      )
    ) WITHOUT ROWID;

CREATE TABLE codex_unread_threads (
          thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

CREATE TABLE codex_project_thread_orders (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          ordered_thread_ids_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) WITHOUT ROWID;

CREATE TABLE codex_sidebar_chat_order (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          ordered_thread_ids_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) WITHOUT ROWID;

CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (length(trim(id)) BETWEEN 1 AND 512)
    ) WITHOUT ROWID;

CREATE TABLE libraries (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL UNIQUE
        REFERENCES profiles(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (length(trim(id)) BETWEEN 1 AND 512)
    ) WITHOUT ROWID;

CREATE TABLE database_containers (
      block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      default_view_id TEXT,
      access_revision INTEGER NOT NULL DEFAULT 1 CHECK (access_revision >= 1),
      metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK (metadata_revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (lifecycle IN ('active', 'archived', 'deleted')),
      CHECK (length(trim(name)) BETWEEN 1 AND 256)
    ) WITHOUT ROWID;

CREATE TABLE data_sources (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
      home_database_block_id TEXT NOT NULL
        REFERENCES database_containers(block_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      schema_key TEXT NOT NULL,
      schema_revision INTEGER NOT NULL DEFAULT 1 CHECK (schema_revision >= 1),
      lifecycle TEXT NOT NULL DEFAULT 'active',
      rank_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (id, home_database_block_id),
      CHECK (lifecycle IN ('active', 'archived', 'deleted')),
      CHECK (length(trim(name)) BETWEEN 1 AND 256)
    ) WITHOUT ROWID;

CREATE TABLE data_source_page_memberships (
      id TEXT PRIMARY KEY,
      data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
      page_block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      removed_at TEXT,
      UNIQUE (id, data_source_id)
    ) WITHOUT ROWID;

CREATE TABLE project_database_bindings (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
      database_block_id TEXT NOT NULL
        REFERENCES database_containers(block_id) ON DELETE RESTRICT,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (lifecycle IN ('active', 'inactive', 'archived'))
    ) WITHOUT ROWID;

CREATE TABLE project_resource_grants (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
      root_kind TEXT NOT NULL,
      root_id TEXT NOT NULL,
      access TEXT NOT NULL,
      recursive INTEGER NOT NULL DEFAULT 1 CHECK (recursive = 1),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      lifecycle TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (project_id, root_kind, root_id),
      CHECK (root_kind IN ('page', 'database')),
      CHECK (access IN ('read', 'read_write')),
      CHECK (lifecycle IN ('active', 'revoked'))
    ) WITHOUT ROWID;

CREATE TABLE pages (
      block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
      document_id TEXT NOT NULL UNIQUE REFERENCES documents(id) ON DELETE RESTRICT,
      parent_kind TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      parent_revision INTEGER NOT NULL DEFAULT 1 CHECK (parent_revision >= 1),
      metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK (metadata_revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (parent_kind IN ('library', 'page', 'data_source')),
      CHECK (lifecycle IN ('active', 'archived', 'deleted')),
      CHECK (length(trim(parent_id)) BETWEEN 1 AND 512)
    ) WITHOUT ROWID;

CREATE TABLE library_block_placements (
      block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
      rank_key TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (block_id, library_id)
    ) WITHOUT ROWID;

CREATE TABLE database_module_receipts (
      operation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
      store_epoch TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      request_json TEXT NOT NULL,
      outcome TEXT NOT NULL,
      result_json TEXT NOT NULL,
      change_log_seq INTEGER,
      created_at TEXT NOT NULL,
      CHECK (length(trim(operation_id)) BETWEEN 1 AND 512),
      CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
      CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
      CHECK (outcome IN ('committed', 'rejected')),
      CHECK (json_valid(result_json) AND json_type(result_json) = 'object')
    ) WITHOUT ROWID;

CREATE TABLE reminder_snoozes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        "page_id" TEXT NOT NULL REFERENCES blocks(id) ON UPDATE CASCADE ON DELETE CASCADE,
        occurrence_start TEXT NOT NULL,
        due_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        consumed_at TEXT
      );

CREATE TABLE "project_session_tabs" (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      browser_tab_id TEXT,
      panel_id TEXT NOT NULL DEFAULT 'right',
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      config_json TEXT NOT NULL,
      state_key INTEGER NOT NULL DEFAULT 0,
      state_json TEXT NOT NULL DEFAULT '{}',
      "order" INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (kind IN ('db_view', 'page_stage', 'terminal', 'browser', 'review', 'files')),
      CHECK (panel_id IN ('right', 'bottom')),
      CHECK (project_id IS NOT NULL OR kind = 'browser'),
      CHECK (
        (kind = 'browser' AND browser_tab_id IS NOT NULL AND length(trim(browser_tab_id)) > 0)
        OR (kind <> 'browser' AND browser_tab_id IS NULL)
      )
    );

CREATE TABLE "data_source_properties" (
      data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      value_type TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      rank_key TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      schema_revision INTEGER NOT NULL DEFAULT 1 CHECK (schema_revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (data_source_id, id),
      CHECK (length(id) BETWEEN 1 AND 128),
      CHECK (length(name) BETWEEN 1 AND 256),
      CHECK (value_type IN (
        'text', 'number', 'checkbox', 'select', 'multi_select',
        'date', 'datetime', 'person'
      )),
      CHECK (lifecycle IN ('active', 'deleted')),
      CHECK (json_valid(config_json) AND json_type(config_json) = 'object')
    ) WITHOUT ROWID;

CREATE TABLE "data_source_property_values" (
      data_source_id TEXT NOT NULL,
      membership_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (data_source_id, membership_id, property_id),
      FOREIGN KEY (membership_id, data_source_id)
        REFERENCES data_source_page_memberships(id, data_source_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (data_source_id, property_id)
        REFERENCES data_source_properties(data_source_id, id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (value_type IN (
        'text', 'number', 'checkbox', 'select', 'multi_select',
        'date', 'datetime', 'person'
      )),
      CHECK (json_valid(value_json))
    ) WITHOUT ROWID;

CREATE TABLE "database_views" (
      id TEXT PRIMARY KEY,
      database_block_id TEXT NOT NULL,
      data_source_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      rank_key TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (database_block_id)
        REFERENCES database_containers(block_id) ON DELETE CASCADE,
      FOREIGN KEY (data_source_id, database_block_id)
        REFERENCES data_sources(id, home_database_block_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (kind IN ('kanban', 'list', 'calendar', 'canvas')),
      CHECK (lifecycle IN ('active', 'deleted')),
      CHECK (json_valid(config_json) AND json_type(config_json) = 'object')
    ) WITHOUT ROWID;

CREATE TABLE "database_view_page_positions" (
      view_id TEXT NOT NULL,
      page_block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
      group_key TEXT,
      rank_key TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (view_id, page_block_id),
      FOREIGN KEY (view_id) REFERENCES database_views(id) ON DELETE CASCADE
    ) WITHOUT ROWID;

CREATE TABLE "blocks" (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      location_kind TEXT NOT NULL,
      containing_document_id TEXT,
      containing_database_id TEXT,
      location_revision INTEGER NOT NULL DEFAULT 1 CHECK (location_revision >= 1),
      metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK (metadata_revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (id, project_id),
      FOREIGN KEY (containing_document_id)
        REFERENCES documents(id) ON DELETE RESTRICT,
      FOREIGN KEY (containing_database_id)
        REFERENCES database_containers(block_id) ON DELETE RESTRICT,
      CHECK (lifecycle IN ('active', 'archived', 'deleted')),
      CHECK (
        (location_kind = 'space'
          AND containing_document_id IS NULL
          AND containing_database_id IS NULL)
        OR (location_kind = 'document'
          AND containing_document_id IS NOT NULL
          AND containing_database_id IS NULL)
        OR (location_kind = 'database'
          AND containing_document_id IS NULL
          AND containing_database_id IS NOT NULL)
      )
    );

CREATE TABLE "page_read_model" (
      page_block_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      location_kind TEXT NOT NULL,
      containing_document_id TEXT,
      containing_database_id TEXT,
      top_level_rank_key TEXT,
      location_revision INTEGER NOT NULL CHECK (location_revision >= 1),
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
      FOREIGN KEY (page_block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (containing_document_id)
        REFERENCES documents(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (containing_database_id)
        REFERENCES database_containers(block_id) ON DELETE RESTRICT,
      FOREIGN KEY (membership_id)
        REFERENCES data_source_page_memberships(id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (database_block_id)
        REFERENCES database_containers(block_id) ON DELETE RESTRICT,
      FOREIGN KEY (view_id)
        REFERENCES database_views(id) ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (lifecycle IN ('active', 'archived', 'deleted')),
      CHECK (location_kind IN ('space', 'document', 'database')),
      CHECK (
        (location_kind = 'space'
          AND containing_document_id IS NULL
          AND containing_database_id IS NULL)
        OR (location_kind = 'document'
          AND containing_document_id IS NOT NULL
          AND containing_database_id IS NULL)
        OR (location_kind = 'database'
          AND containing_document_id IS NULL
          AND containing_database_id IS NOT NULL)
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
    ) WITHOUT ROWID;

CREATE INDEX idx_project_sources_project_order
      ON project_sources(project_id, "order", created);

CREATE INDEX idx_codex_threads_project_updated
      ON codex_threads(project_id, updated_at DESC);

CREATE INDEX idx_codex_scheduled_automations_target
	      ON codex_scheduled_automations(target_thread_id, kind, status, created_at, automation_id);

CREATE INDEX idx_codex_automation_runs_automation_status_created
	      ON codex_automation_runs(automation_id, status, created_at DESC);

CREATE INDEX idx_codex_automation_runs_unread
	      ON codex_automation_runs(read_at, status, updated_at);

CREATE INDEX idx_codex_background_processes_thread_updated
      ON codex_background_processes(thread_id, updated_at_ms DESC, process_record_id);

CREATE INDEX idx_project_sessions_project_order
      ON project_sessions(project_id, "order", created_at);

CREATE INDEX idx_project_sessions_project_sidebar
      ON project_sessions(project_id, archived, pinned, pinned_order, "order");

CREATE INDEX idx_codex_pinned_threads_order
      ON codex_pinned_threads(pinned_order, created_at);

CREATE INDEX idx_thread_search_units_thread
      ON thread_search_units(thread_id);

CREATE INDEX idx_thread_search_units_project
      ON thread_search_units(project_id);

CREATE INDEX idx_thread_search_units_session
      ON thread_search_units(session_id);

CREATE INDEX idx_block_properties_project_key
      ON block_properties(project_id, property_key, block_id);

CREATE INDEX idx_documents_project_readiness
      ON documents(project_id, readiness, authority);

CREATE INDEX idx_top_level_block_placements_order
      ON top_level_block_placements(project_id, rank_key, block_id);

CREATE INDEX idx_document_updates_tail
      ON document_updates(document_id, generation, seq);

CREATE INDEX idx_document_block_index_parent_order
      ON document_block_index(document_id, parent_block_id, ordinal, block_id);

CREATE INDEX idx_retired_block_identities_project_time
      ON retired_block_identities(project_id, retired_at, block_id);

CREATE UNIQUE INDEX idx_recurrence_exceptions_unique
      ON recurrence_exceptions(project_id, "page_id", occurrence_start);

CREATE INDEX idx_recurrence_exceptions_lookup
      ON recurrence_exceptions(project_id, "page_id", occurrence_start);

CREATE UNIQUE INDEX idx_reminder_receipts_unique
      ON reminder_receipts(
        project_id, "page_id", occurrence_start, reminder_offset_minutes
      );

CREATE INDEX idx_reminder_receipts_lookup
      ON reminder_receipts(project_id, delivered_at DESC);

CREATE UNIQUE INDEX idx_block_documents_owner_document_project
      ON block_documents(block_id, document_id, project_id);

CREATE INDEX idx_change_log_project_seq
      ON change_log(project_id, seq);

CREATE INDEX idx_change_log_kind_seq
      ON change_log(kind, seq);

CREATE UNIQUE INDEX idx_change_log_operation
      ON change_log(project_id, kind, operation_id)
      WHERE operation_id IS NOT NULL;

CREATE INDEX idx_block_relocations_project_committed
      ON block_relocations(project_id, committed_at, id);

CREATE INDEX idx_block_relocations_source
      ON block_relocations(
        source_document_id, source_generation, source_base_head_seq, id
      );

CREATE INDEX idx_block_relocations_target
      ON block_relocations(target_document_id, target_generation, id)
      WHERE target_document_id IS NOT NULL;

CREATE INDEX idx_block_relocation_members_block
      ON block_relocation_members(block_id, relocation_id);

CREATE INDEX idx_block_relocation_members_roots
      ON block_relocation_members(relocation_id, tree_ordinal)
      WHERE is_root = 1;

CREATE INDEX idx_block_relocation_source_states_document
      ON block_relocation_source_states(document_id, generation, head_seq);

CREATE INDEX idx_document_recovery_artifacts_document
      ON document_recovery_artifacts(
        document_id, generation, status, created_at, id
      );

CREATE INDEX idx_document_recovery_artifacts_expiry
      ON document_recovery_artifacts(status, expires_at, id);

CREATE INDEX idx_document_versions_document_head
      ON document_versions(document_id, generation, base_head_seq DESC, created_at DESC);

CREATE INDEX idx_document_versions_project_created
      ON document_versions(project_id, created_at DESC, version_id);

CREATE INDEX idx_document_versions_source_mutation
      ON document_versions(source_mutation_id)
      WHERE source_mutation_id IS NOT NULL;

CREATE INDEX idx_document_versions_retention
      ON document_versions(document_id, pinned, created_at DESC, version_id);

CREATE INDEX idx_document_revision_sessions_due
      ON document_revision_sessions(last_edit_at, document_id);

CREATE INDEX idx_block_mutations_project_recorded
      ON block_mutations(project_id, recorded_at DESC, mutation_id);

CREATE INDEX idx_block_mutations_session_recorded
      ON block_mutations(project_id, client_session_id, recorded_at DESC)
      WHERE client_session_id IS NOT NULL;

CREATE INDEX idx_block_search_units_project_source
      ON block_search_units(project_id, source_kind, block_id);

CREATE INDEX idx_block_search_units_document_freshness
      ON block_search_units(document_id, document_generation, projected_seq)
      WHERE document_id IS NOT NULL;

CREATE INDEX idx_block_asset_refs_project_uri
      ON block_asset_refs(project_id, asset_uri, block_id);

CREATE INDEX idx_block_asset_refs_document_freshness
      ON block_asset_refs(document_id, document_generation, projected_seq);

CREATE INDEX idx_canvas_scene_file_refs_owner
      ON canvas_scene_file_refs(project_id, owner_block_id, file_id);

CREATE INDEX idx_canvas_scene_elements_order
      ON canvas_scene_elements(document_id, order_key, element_id);

CREATE INDEX idx_canvas_scene_mutation_receipts_head
      ON canvas_scene_mutation_receipts(document_id, generation, committed_head_seq);

CREATE UNIQUE INDEX idx_project_session_threads_thread
        ON project_session_threads(thread_id);

CREATE INDEX idx_database_containers_library_lifecycle
      ON database_containers(library_id, lifecycle, block_id);

CREATE INDEX idx_data_sources_home_order
      ON data_sources(home_database_block_id, lifecycle, rank_key, id);

CREATE UNIQUE INDEX idx_data_source_memberships_active_page
      ON data_source_page_memberships(page_block_id)
      WHERE removed_at IS NULL;

CREATE UNIQUE INDEX idx_data_source_memberships_history
      ON data_source_page_memberships(data_source_id, page_block_id);

CREATE INDEX idx_data_source_memberships_source_active
      ON data_source_page_memberships(data_source_id, removed_at, page_block_id);

CREATE UNIQUE INDEX idx_project_database_bindings_active
      ON project_database_bindings(database_block_id)
      WHERE lifecycle = 'active';

CREATE INDEX idx_project_resource_grants_active
      ON project_resource_grants(project_id, lifecycle, root_kind, root_id);

CREATE INDEX idx_pages_library_parent
      ON pages(library_id, parent_kind, parent_id, lifecycle, block_id);

CREATE INDEX idx_pages_document
      ON pages(document_id, block_id);

CREATE INDEX idx_library_block_placements_order
      ON library_block_placements(library_id, rank_key, block_id);

CREATE INDEX idx_database_module_receipts_project_created
      ON database_module_receipts(project_id, created_at, operation_id);

CREATE INDEX idx_reminder_snoozes_lookup
        ON reminder_snoozes(project_id, due_at, consumed_at);

CREATE INDEX idx_project_session_tabs_session_order
      ON project_session_tabs(session_id, panel_id, "order", created_at);

CREATE INDEX idx_project_session_tabs_project
      ON project_session_tabs(project_id);

CREATE INDEX idx_project_session_tabs_browser_identity
      ON project_session_tabs(session_id, browser_tab_id);

CREATE INDEX idx_scheduled_page_index_due
      ON "scheduled_page_index"(project_id, scheduled_start, "page_block_id")
      WHERE lifecycle = 'active' AND scheduled_start IS NOT NULL;

CREATE INDEX idx_canvas_page_references_target
      ON "canvas_page_references"(project_id, target_block_id, document_id);

CREATE INDEX idx_data_source_properties_order
      ON data_source_properties(data_source_id, lifecycle, rank_key, id);

CREATE INDEX idx_data_source_property_values_property
      ON data_source_property_values(data_source_id, property_id, membership_id);

CREATE INDEX idx_database_views_database_order
      ON database_views(database_block_id, lifecycle, rank_key, id);

CREATE INDEX idx_database_views_source
      ON database_views(data_source_id, lifecycle, id);

CREATE INDEX idx_database_view_page_positions_order
      ON database_view_page_positions(
        view_id, group_key, rank_key, page_block_id
      );

CREATE INDEX idx_blocks_containing_database
      ON blocks(containing_database_id, lifecycle, id);

CREATE INDEX idx_blocks_containing_document
      ON blocks(containing_document_id, lifecycle);

CREATE INDEX idx_blocks_project_lifecycle_type
      ON blocks(project_id, lifecycle, type);

CREATE INDEX idx_page_read_model_project_lifecycle
      ON page_read_model(project_id, lifecycle, page_block_id);

CREATE INDEX idx_page_read_model_view_order
      ON page_read_model(view_id, view_group_key, view_rank_key, page_block_id)
      WHERE view_id IS NOT NULL;

CREATE INDEX idx_page_read_model_document_freshness
      ON page_read_model(document_id, document_generation, document_projected_seq);

CREATE TRIGGER nodex_agent_call_receipts_validate_update
    BEFORE UPDATE ON nodex_agent_call_receipts
    WHEN OLD.status = 'committed'
      OR NEW.call_identity IS NOT OLD.call_identity
      OR NEW.thread_id IS NOT OLD.thread_id
      OR NEW.turn_id IS NOT OLD.turn_id
      OR NEW.call_id IS NOT OLD.call_id
      OR NEW.project_id IS NOT OLD.project_id
      OR NEW.tool IS NOT OLD.tool
      OR NEW.request_hash IS NOT OLD.request_hash
      OR NEW.mutation_id IS NOT OLD.mutation_id
      OR NEW.authority_fingerprint IS NOT OLD.authority_fingerprint
      OR NEW.provenance_version IS NOT OLD.provenance_version
      OR NEW.created_at IS NOT OLD.created_at
      OR (OLD.status = 'prepared' AND NEW.status NOT IN ('prepared', 'committed'))
    BEGIN
      SELECT RAISE(ABORT, 'Nodex Agent call receipt identity is immutable');
    END;

CREATE TRIGGER nodex_agent_turn_authorities_are_immutable
    BEFORE UPDATE ON nodex_agent_turn_authorities
    BEGIN
      SELECT RAISE(ABORT, 'Nodex Agent Turn authorities are immutable');
    END;

CREATE TRIGGER nodex_agent_turn_authorities_cannot_delete
    BEFORE DELETE ON nodex_agent_turn_authorities
    BEGIN
      SELECT RAISE(ABORT, 'Nodex Agent Turn authorities are immutable');
    END;

CREATE TRIGGER library_content_relocation_members_validate_insert
    BEFORE INSERT ON library_content_relocation_members
    WHEN NOT EXISTS (
      SELECT 1
      FROM library_content_relocations relocation
      WHERE relocation.operation_id = NEW.operation_id
        AND relocation.source_project_id = NEW.source_project_id
        AND relocation.target_project_id = NEW.final_project_id
    ) OR (
      NEW.resource_kind = 'block'
      AND NOT EXISTS (
        SELECT 1 FROM blocks block
        WHERE block.id = NEW.resource_id
          AND block.project_id = NEW.final_project_id
      )
    ) OR (
      NEW.resource_kind = 'document'
      AND NOT EXISTS (
        SELECT 1 FROM documents document
        WHERE document.id = NEW.resource_id
          AND document.project_id = NEW.final_project_id
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'Library content relocation member is invalid');
    END;

CREATE TRIGGER library_content_relocations_are_immutable
    BEFORE UPDATE ON library_content_relocations
    BEGIN
      SELECT RAISE(ABORT, 'Library content relocations are immutable');
    END;

CREATE TRIGGER library_content_relocations_cannot_delete
    BEFORE DELETE ON library_content_relocations
    BEGIN
      SELECT RAISE(ABORT, 'Library content relocations are immutable');
    END;

CREATE TRIGGER library_content_relocation_members_are_immutable
    BEFORE UPDATE ON library_content_relocation_members
    BEGIN
      SELECT RAISE(ABORT, 'Library content relocation members are immutable');
    END;

CREATE TRIGGER library_content_relocation_members_cannot_delete
    BEFORE DELETE ON library_content_relocation_members
    BEGIN
      SELECT RAISE(ABORT, 'Library content relocation members are immutable');
    END;

CREATE TRIGGER thread_search_units_ai
      AFTER INSERT ON thread_search_units
      BEGIN
        INSERT INTO thread_search_units_fts(rowid, text)
        VALUES (new.rowid, new.text);
      END;

CREATE TRIGGER thread_search_units_ad
      AFTER DELETE ON thread_search_units
      BEGIN
        INSERT INTO thread_search_units_fts(thread_search_units_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
      END;

CREATE TRIGGER thread_search_units_au
      AFTER UPDATE ON thread_search_units
      BEGIN
        INSERT INTO thread_search_units_fts(thread_search_units_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
        INSERT INTO thread_search_units_fts(rowid, text)
        VALUES (new.rowid, new.text);
      END;

CREATE TRIGGER top_level_block_placements_require_space
      BEFORE INSERT ON top_level_block_placements
      WHEN (SELECT location_kind FROM blocks WHERE id = NEW.block_id) <> 'space'
      BEGIN
        SELECT RAISE(ABORT, 'top-level placement requires a space block');
      END;

CREATE TRIGGER top_level_block_placements_updates_require_space
      BEFORE UPDATE OF block_id, project_id ON top_level_block_placements
      WHEN (SELECT location_kind FROM blocks WHERE id = NEW.block_id) <> 'space'
      BEGIN
        SELECT RAISE(ABORT, 'top-level placement requires a space block');
      END;

CREATE TRIGGER document_block_index_requires_matching_location
      BEFORE INSERT ON document_block_index
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks block
        WHERE block.id = NEW.block_id
          AND block.location_kind = 'document'
          AND block.containing_document_id = NEW.document_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'indexed block must belong to the indexed document');
      END;

CREATE TRIGGER document_block_index_updates_require_matching_location
      BEFORE UPDATE OF document_id, block_id ON document_block_index
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks block
        WHERE block.id = NEW.block_id
          AND block.location_kind = 'document'
          AND block.containing_document_id = NEW.document_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'indexed block must belong to the indexed document');
      END;

CREATE TRIGGER document_block_index_parent_requires_matching_location
      BEFORE INSERT ON document_block_index
      WHEN NEW.parent_block_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks parent
          WHERE parent.id = NEW.parent_block_id
            AND parent.location_kind = 'document'
            AND parent.containing_document_id = NEW.document_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'indexed parent must belong to the indexed document');
      END;

CREATE TRIGGER document_block_index_parent_updates_require_matching_location
      BEFORE UPDATE OF document_id, parent_block_id ON document_block_index
      WHEN NEW.parent_block_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks parent
          WHERE parent.id = NEW.parent_block_id
            AND parent.location_kind = 'document'
            AND parent.containing_document_id = NEW.document_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'indexed parent must belong to the indexed document');
      END;

CREATE TRIGGER retired_block_identities_are_immutable_update
      BEFORE UPDATE ON retired_block_identities
      BEGIN
        SELECT RAISE(ABORT, 'retired Block identity evidence is immutable');
      END;

CREATE TRIGGER retired_block_identities_are_immutable_delete
      BEFORE DELETE ON retired_block_identities
      BEGIN
        SELECT RAISE(ABORT, 'retired Block identity evidence is immutable');
      END;

CREATE TRIGGER recurrence_exceptions_require_card_block_insert
        BEFORE INSERT ON recurrence_exceptions
        WHEN NOT EXISTS (
          SELECT 1
          FROM blocks block
          WHERE block.id = NEW."page_id"
            AND block.project_id = NEW.project_id
            AND block.type = 'page'
        )
        BEGIN
          SELECT RAISE(ABORT, 'recurrence exception owner must be a Card Block in the same Project');
        END;

CREATE TRIGGER recurrence_exceptions_require_card_block_update
        BEFORE UPDATE OF "page_id", project_id
        ON recurrence_exceptions
        WHEN NOT EXISTS (
          SELECT 1
          FROM blocks block
          WHERE block.id = NEW."page_id"
            AND block.project_id = NEW.project_id
            AND block.type = 'page'
        )
        BEGIN
          SELECT RAISE(ABORT, 'recurrence exception owner must be a Card Block in the same Project');
        END;

CREATE TRIGGER reminder_receipts_require_card_block_insert
        BEFORE INSERT ON reminder_receipts
        WHEN NOT EXISTS (
          SELECT 1
          FROM blocks block
          WHERE block.id = NEW."page_id"
            AND block.project_id = NEW.project_id
            AND block.type = 'page'
        )
        BEGIN
          SELECT RAISE(ABORT, 'reminder receipt owner must be a Card Block in the same Project');
        END;

CREATE TRIGGER reminder_receipts_require_card_block_update
        BEFORE UPDATE OF "page_id", project_id
        ON reminder_receipts
        WHEN NOT EXISTS (
          SELECT 1
          FROM blocks block
          WHERE block.id = NEW."page_id"
            AND block.project_id = NEW.project_id
            AND block.type = 'page'
        )
        BEGIN
          SELECT RAISE(ABORT, 'reminder receipt owner must be a Card Block in the same Project');
        END;

CREATE TRIGGER scheduled_card_index_require_card_block_insert
        BEFORE INSERT ON "scheduled_page_index"
        WHEN NOT EXISTS (
          SELECT 1
          FROM blocks block
          WHERE block.id = NEW."page_block_id"
            AND block.project_id = NEW.project_id
            AND block.type = 'page'
        )
        BEGIN
          SELECT RAISE(ABORT, 'scheduled Card index owner must be a Card Block in the same Project');
        END;

CREATE TRIGGER scheduled_card_index_require_card_block_update
        BEFORE UPDATE OF "page_block_id", project_id
        ON "scheduled_page_index"
        WHEN NOT EXISTS (
          SELECT 1
          FROM blocks block
          WHERE block.id = NEW."page_block_id"
            AND block.project_id = NEW.project_id
            AND block.type = 'page'
        )
        BEGIN
          SELECT RAISE(ABORT, 'scheduled Card index owner must be a Card Block in the same Project');
        END;

CREATE TRIGGER block_relocations_validate_insert
      BEFORE INSERT ON block_relocations
      WHEN EXISTS (
        SELECT 1
        FROM json_each(NEW.root_block_ids_json) root
        WHERE root.type <> 'text'
          OR length(root.value) < 1
          OR length(root.value) > 512
      ) OR (
        SELECT COUNT(*) FROM json_each(NEW.root_block_ids_json)
      ) <> (
        SELECT COUNT(DISTINCT root.value)
        FROM json_each(NEW.root_block_ids_json) root
      ) OR EXISTS (
        SELECT 1
        FROM json_each(NEW.expected_location_revisions_json) revision
        WHERE revision.type <> 'integer' OR revision.value < 1
      ) OR EXISTS (
        SELECT 1
        FROM json_each(NEW.root_block_ids_json) root
        WHERE NOT EXISTS (
          SELECT 1
          FROM json_each(NEW.expected_location_revisions_json) revision
          WHERE revision.key = root.value
        )
      ) OR EXISTS (
        SELECT 1
        FROM json_each(NEW.expected_location_revisions_json) revision
        WHERE NOT EXISTS (
          SELECT 1
          FROM json_each(NEW.root_block_ids_json) root
          WHERE root.value = revision.key
        )
      ) OR EXISTS (
        SELECT 1
        FROM json_each(NEW.final_location_revisions_json) revision
        WHERE revision.type <> 'integer' OR revision.value < 2
      ) OR NOT EXISTS (
        SELECT 1
        FROM change_log change
        WHERE change.seq = NEW.change_log_seq
          AND change.project_id = NEW.project_id
          AND change.store_epoch = NEW.store_epoch
          AND change.kind = 'block_relocation'
          AND change.operation_id = NEW.id
      ) OR NOT EXISTS (
        SELECT 1
        FROM document_update_receipts receipt
        WHERE receipt.document_id = NEW.source_document_id
          AND receipt.generation = NEW.source_generation
          AND receipt.seq = NEW.source_committed_seq
          AND receipt.update_id = NEW.source_update_id
      ) OR NOT EXISTS (
        SELECT 1
        FROM documents document
        WHERE document.id = NEW.source_document_id
          AND document.project_id = NEW.project_id
          AND document.generation = NEW.source_generation
          AND document.head_seq = NEW.source_committed_seq
          AND document.readiness = 'ready'
      ) OR (
        NEW.target_kind = 'document'
        AND NOT EXISTS (
          SELECT 1
          FROM document_update_receipts receipt
          WHERE receipt.document_id = NEW.target_document_id
            AND receipt.generation = NEW.target_generation
            AND receipt.seq = NEW.target_committed_seq
            AND receipt.update_id = NEW.target_update_id
        )
      ) OR (
        NEW.target_kind = 'document'
        AND NOT EXISTS (
          SELECT 1
          FROM documents document
          WHERE document.id = NEW.target_document_id
            AND document.project_id = NEW.target_project_id
            AND document.generation = NEW.target_generation
            AND document.head_seq = NEW.target_committed_seq
            AND document.readiness = 'ready'
        )
      ) OR (
        NEW.target_parent_block_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks parent
          WHERE parent.id = NEW.target_parent_block_id
            AND parent.project_id = NEW.target_project_id
            AND parent.location_kind = 'document'
            AND parent.containing_document_id = NEW.target_document_id
        )
      ) OR (
        NEW.target_before_block_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks anchor
          WHERE anchor.id = NEW.target_before_block_id
            AND anchor.project_id = NEW.target_project_id
            AND (
              (NEW.target_kind = 'document'
                AND anchor.location_kind = 'document'
                AND anchor.containing_document_id = NEW.target_document_id)
              OR (NEW.target_kind = 'space'
                AND anchor.location_kind = 'space')
            )
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'block relocation ledger is invalid');
      END;

CREATE TRIGGER block_relocations_are_immutable
      BEFORE UPDATE ON block_relocations
      BEGIN
        SELECT RAISE(ABORT, 'committed block relocations are immutable');
      END;

CREATE TRIGGER block_relocation_members_validate_insert
      BEFORE INSERT ON block_relocation_members
      WHEN NOT EXISTS (
        SELECT 1
        FROM block_relocations relocation
        WHERE relocation.id = NEW.relocation_id
          AND relocation.project_id = NEW.source_project_id
          AND relocation.target_project_id = NEW.final_project_id
      ) OR NOT EXISTS (
        SELECT 1
        FROM blocks block
        WHERE block.id = NEW.block_id
          AND block.project_id = NEW.final_project_id
          AND block.location_revision = NEW.final_location_revision
      ) OR NEW.is_root <> EXISTS (
        SELECT 1
        FROM block_relocations relocation,
          json_each(relocation.root_block_ids_json) root
        WHERE relocation.id = NEW.relocation_id
          AND root.value = NEW.block_id
      ) OR NOT EXISTS (
        SELECT 1
        FROM block_relocations relocation,
          json_each(relocation.final_location_revisions_json) revision
        WHERE relocation.id = NEW.relocation_id
          AND revision.key = NEW.block_id
          AND revision.value = NEW.final_location_revision
      ) OR (
        NEW.is_root = 1
        AND NOT EXISTS (
          SELECT 1
          FROM block_relocations relocation,
            json_each(relocation.expected_location_revisions_json) revision
          WHERE relocation.id = NEW.relocation_id
            AND revision.key = NEW.block_id
            AND revision.value = NEW.source_location_revision
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'block relocation member is invalid');
      END;

CREATE TRIGGER block_relocation_members_are_immutable
      BEFORE UPDATE ON block_relocation_members
      BEGIN
        SELECT RAISE(ABORT, 'committed block relocation members are immutable');
      END;

CREATE TRIGGER block_relocation_source_states_are_immutable
      BEFORE UPDATE ON block_relocation_source_states
      BEGIN
        SELECT RAISE(ABORT, 'committed block relocation source states are immutable');
      END;

CREATE TRIGGER document_recovery_artifacts_validate_insert
      BEFORE INSERT ON document_recovery_artifacts
      WHEN EXISTS (
        SELECT 1
        FROM json_each(NEW.touched_block_ids_json) touched
        WHERE touched.type <> 'text'
          OR length(touched.value) < 1
          OR length(touched.value) > 512
      ) OR (
        SELECT COUNT(*) FROM json_each(NEW.touched_block_ids_json)
      ) <> (
        SELECT COUNT(DISTINCT touched.value)
        FROM json_each(NEW.touched_block_ids_json) touched
      ) OR EXISTS (
        SELECT 1
        FROM json_each(COALESCE(NEW.derived_touched_block_ids_json, '[]')) touched
        WHERE touched.type <> 'text'
          OR length(touched.value) < 1
          OR length(touched.value) > 512
      ) OR (
        SELECT COUNT(*)
        FROM json_each(COALESCE(NEW.derived_touched_block_ids_json, '[]'))
      ) <> (
        SELECT COUNT(DISTINCT touched.value)
        FROM json_each(COALESCE(NEW.derived_touched_block_ids_json, '[]')) touched
      ) OR EXISTS (
        SELECT 1
        FROM json_each(NEW.relocation_ids_json) relocation_id
        WHERE relocation_id.type <> 'text'
          OR length(relocation_id.value) < 1
          OR length(relocation_id.value) > 512
          OR NOT EXISTS (
          SELECT 1
          FROM block_relocations relocation
          WHERE relocation.id = relocation_id.value
            AND relocation.project_id = NEW.project_id
        )
      ) OR (
        SELECT COUNT(*) FROM json_each(NEW.relocation_ids_json)
      ) <> (
        SELECT COUNT(DISTINCT relocation_id.value)
        FROM json_each(NEW.relocation_ids_json) relocation_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'document recovery artifact is invalid');
      END;

CREATE TRIGGER document_recovery_artifacts_validate_update
      BEFORE UPDATE ON document_recovery_artifacts
      WHEN NEW.id <> OLD.id
        OR NEW.project_id <> OLD.project_id
        OR NEW.store_epoch <> OLD.store_epoch
        OR NEW.document_id <> OLD.document_id
        OR NEW.generation <> OLD.generation
        OR NEW.update_id <> OLD.update_id
        OR NEW.client_session_id <> OLD.client_session_id
        OR NEW.base_head_seq <> OLD.base_head_seq
        OR NEW.touched_block_ids_json <> OLD.touched_block_ids_json
        OR COALESCE(NEW.derived_touched_block_ids_json, '') <>
          COALESCE(OLD.derived_touched_block_ids_json, '')
        OR NEW.update_blob <> OLD.update_blob
        OR NEW.update_hash <> OLD.update_hash
        OR NEW.update_byte_length <> OLD.update_byte_length
        OR NEW.reason <> OLD.reason
        OR NEW.relocation_ids_json <> OLD.relocation_ids_json
        OR NEW.created_at <> OLD.created_at
        OR NEW.expires_at <> OLD.expires_at
        OR OLD.status <> 'pending'
        OR NEW.status = 'pending'
      BEGIN
        SELECT RAISE(ABORT, 'document recovery artifact payload is immutable');
      END;

CREATE TRIGGER document_versions_validate_insert
      BEFORE INSERT ON document_versions
      WHEN NOT EXISTS (
        SELECT 1
        FROM documents document
        WHERE document.id = NEW.document_id
          AND document.project_id = NEW.project_id
          AND document.readiness = 'ready'
          AND document.generation = NEW.generation
          AND document.head_seq >= NEW.base_head_seq
          AND document.schema_key = NEW.schema_key
          AND document.schema_version = NEW.schema_version
      )
      BEGIN
        SELECT RAISE(ABORT, 'document version source is not a current ready Document');
      END;

CREATE TRIGGER block_mutations_reject_id_collision
      BEFORE INSERT ON block_mutations
      WHEN EXISTS (
        SELECT 1
        FROM block_mutations existing
        WHERE existing.mutation_id = NEW.mutation_id
          AND (
            existing.project_id <> NEW.project_id
            OR existing.store_epoch <> NEW.store_epoch
            OR existing.mutation_kind <> NEW.mutation_kind
            OR existing.actor_json <> NEW.actor_json
            OR COALESCE(existing.client_session_id, '') <>
              COALESCE(NEW.client_session_id, '')
            OR existing.request_hash <> NEW.request_hash
            OR existing.request_json <> NEW.request_json
            OR existing.target_block_ids_json <> NEW.target_block_ids_json
            OR existing.affected_document_ids_json <>
              NEW.affected_document_ids_json
            OR existing.affected_database_block_ids_json <>
              NEW.affected_database_block_ids_json
            OR existing.field_intents_json <> NEW.field_intents_json
            OR existing.expected_revisions_json <>
              NEW.expected_revisions_json
            OR existing.outcome <> NEW.outcome
            OR existing.result_json <> NEW.result_json
            OR existing.committed_revisions_json <>
              NEW.committed_revisions_json
            OR existing.document_heads_json <> NEW.document_heads_json
            OR COALESCE(existing.change_log_seq, -1) <>
              COALESCE(NEW.change_log_seq, -1)
          )
      )
      BEGIN
        SELECT RAISE(ABORT, 'block mutation id collides with another request or result');
      END;

CREATE TRIGGER block_search_units_ai
      AFTER INSERT ON block_search_units
      BEGIN
        INSERT INTO block_search_units_fts(rowid, text)
        VALUES (NEW.rowid, NEW.text);
      END;

CREATE TRIGGER block_search_units_ad
      AFTER DELETE ON block_search_units
      BEGIN
        INSERT INTO block_search_units_fts(block_search_units_fts, rowid, text)
        VALUES ('delete', OLD.rowid, OLD.text);
      END;

CREATE TRIGGER block_search_units_au
      AFTER UPDATE ON block_search_units
      BEGIN
        INSERT INTO block_search_units_fts(block_search_units_fts, rowid, text)
        VALUES ('delete', OLD.rowid, OLD.text);
        INSERT INTO block_search_units_fts(rowid, text)
        VALUES (NEW.rowid, NEW.text);
      END;

CREATE TRIGGER block_search_units_validate_insert
      BEFORE INSERT ON block_search_units
      WHEN (
          NEW.document_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM documents document
            INNER JOIN block_documents ownership
              ON ownership.document_id = document.id
              AND ownership.project_id = document.project_id
            INNER JOIN blocks source
              ON source.id = NEW.block_id
              AND source.project_id = NEW.project_id
            WHERE document.id = NEW.document_id
              AND document.project_id = NEW.project_id
              AND document.generation = NEW.document_generation
              AND document.head_seq >= NEW.projected_seq
              AND ownership.block_id = NEW.owner_block_id
              AND (
                source.id = ownership.block_id
                OR (
                  source.location_kind = 'document'
                  AND source.containing_document_id = document.id
                )
              )
          )
        ) OR (
          NEW.document_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM blocks source
            WHERE source.id = NEW.block_id
              AND source.project_id = NEW.project_id
              AND source.metadata_revision >= NEW.source_revision
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'Block search projection source is invalid or from the future');
      END;

CREATE TRIGGER block_search_units_validate_update
      BEFORE UPDATE ON block_search_units
      WHEN (
          NEW.document_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM documents document
            INNER JOIN block_documents ownership
              ON ownership.document_id = document.id
              AND ownership.project_id = document.project_id
            INNER JOIN blocks source
              ON source.id = NEW.block_id
              AND source.project_id = NEW.project_id
            WHERE document.id = NEW.document_id
              AND document.project_id = NEW.project_id
              AND document.generation = NEW.document_generation
              AND document.head_seq >= NEW.projected_seq
              AND ownership.block_id = NEW.owner_block_id
              AND (
                source.id = ownership.block_id
                OR (
                  source.location_kind = 'document'
                  AND source.containing_document_id = document.id
                )
              )
          )
        ) OR (
          NEW.document_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM blocks source
            WHERE source.id = NEW.block_id
              AND source.project_id = NEW.project_id
              AND source.metadata_revision >= NEW.source_revision
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'Block search projection source is invalid or from the future');
      END;

CREATE TRIGGER block_asset_refs_validate_insert
      BEFORE INSERT ON block_asset_refs
      WHEN NOT EXISTS (
        SELECT 1
        FROM documents document
        INNER JOIN block_documents ownership
          ON ownership.document_id = document.id
          AND ownership.project_id = document.project_id
        INNER JOIN document_block_index block_index
          ON block_index.document_id = document.id
          AND block_index.block_id = NEW.block_id
        WHERE document.id = NEW.document_id
          AND document.project_id = NEW.project_id
          AND document.generation = NEW.document_generation
          AND document.head_seq >= NEW.projected_seq
          AND ownership.block_id = NEW.owner_block_id
          AND block_index.projected_seq = NEW.projected_seq
      )
      BEGIN
        SELECT RAISE(ABORT, 'Block asset projection source is invalid or from the future');
      END;

CREATE TRIGGER block_asset_refs_validate_update
      BEFORE UPDATE ON block_asset_refs
      WHEN NOT EXISTS (
        SELECT 1
        FROM documents document
        INNER JOIN block_documents ownership
          ON ownership.document_id = document.id
          AND ownership.project_id = document.project_id
        INNER JOIN document_block_index block_index
          ON block_index.document_id = document.id
          AND block_index.block_id = NEW.block_id
        WHERE document.id = NEW.document_id
          AND document.project_id = NEW.project_id
          AND document.generation = NEW.document_generation
          AND document.head_seq >= NEW.projected_seq
          AND ownership.block_id = NEW.owner_block_id
          AND block_index.projected_seq = NEW.projected_seq
      )
      BEGIN
        SELECT RAISE(ABORT, 'Block asset projection source is invalid or from the future');
      END;

CREATE TRIGGER canvas_scene_mutation_receipts_immutable_update
      BEFORE UPDATE ON canvas_scene_mutation_receipts
      BEGIN
        SELECT RAISE(ABORT, 'Canvas scene mutation receipts are immutable');
      END;

CREATE TRIGGER canvas_scenes_require_scene_engine
      BEFORE INSERT ON canvas_scenes
      WHEN COALESCE((
        SELECT sync_engine FROM documents WHERE id = NEW.document_id
      ), '') <> 'canvas_scene'
      BEGIN
        SELECT RAISE(ABORT, 'Canvas scene authority requires canvas_scene sync engine');
      END;

CREATE TRIGGER document_updates_require_yjs_engine
      BEFORE INSERT ON document_updates
      WHEN COALESCE((
        SELECT sync_engine FROM documents WHERE id = NEW.document_id
      ), '') <> 'yjs'
      BEGIN
        SELECT RAISE(ABORT, 'Document update requires yjs sync engine');
      END;

CREATE TRIGGER document_snapshots_require_yjs_engine
      BEFORE INSERT ON document_snapshots
      WHEN COALESCE((
        SELECT sync_engine FROM documents WHERE id = NEW.document_id
      ), '') <> 'yjs'
      BEGIN
        SELECT RAISE(ABORT, 'Document snapshot requires yjs sync engine');
      END;

CREATE TRIGGER documents_sync_engine_immutable
      BEFORE UPDATE OF sync_engine ON documents
      WHEN NEW.sync_engine <> OLD.sync_engine
      BEGIN
        SELECT RAISE(ABORT, 'Owned Document sync engine is immutable');
      END;

CREATE TRIGGER canvas_documents_require_empty_yjs_state_insert
      BEFORE INSERT ON documents
      WHEN NEW.sync_engine = 'canvas_scene'
        AND (length(NEW.state_vector) <> 0 OR NEW.state_hash = '')
      BEGIN
        SELECT RAISE(ABORT, 'Canvas Document cannot contain Yjs state');
      END;

CREATE TRIGGER canvas_documents_require_empty_yjs_state_update
      BEFORE UPDATE OF state_vector, state_hash ON documents
      WHEN NEW.sync_engine = 'canvas_scene'
        AND (length(NEW.state_vector) <> 0 OR NEW.state_hash = '')
      BEGIN
        SELECT RAISE(ABORT, 'Canvas Document cannot contain Yjs state');
      END;

CREATE TRIGGER document_update_receipts_require_yjs_engine
      BEFORE INSERT ON document_update_receipts
      WHEN COALESCE((
        SELECT sync_engine FROM documents WHERE id = NEW.document_id
      ), '') <> 'yjs'
      BEGIN
        SELECT RAISE(ABORT, 'Document update receipt requires yjs sync engine');
      END;

CREATE TRIGGER document_versions_validate_checkpoint_format
      BEFORE INSERT ON document_versions
      WHEN (
        NEW.checkpoint_format IN (
          'block_tree_snapshot_v2', 'canvas_scene_json_v1'
        )
        AND (
          length(NEW.state_vector) <> 0
          OR json_valid(CAST(NEW.full_update_blob AS TEXT)) = 0
          OR json_type(CAST(NEW.full_update_blob AS TEXT)) <> 'object'
        )
      ) OR NEW.checkpoint_format NOT IN (
        'yjs_update_v1', 'block_tree_snapshot_v2', 'canvas_scene_json_v1'
      )
      BEGIN
        SELECT RAISE(ABORT, 'Document checkpoint format does not match its payload');
      END;

CREATE TRIGGER projects_binding_after_update
      AFTER UPDATE OF library_id, database_block_id, lifecycle,
        binding_revision, updated ON projects
      WHEN NEW.database_block_id IS NOT NULL AND NEW.library_id IS NOT NULL
      BEGIN
        INSERT INTO project_database_bindings (
          project_id, library_id, database_block_id, lifecycle, revision,
          created_at, updated_at
        ) VALUES (
          NEW.id, NEW.library_id, NEW.database_block_id, NEW.lifecycle,
          NEW.binding_revision, NEW.created, NEW.updated
        )
        ON CONFLICT(project_id) DO UPDATE SET
          library_id = excluded.library_id,
          database_block_id = excluded.database_block_id,
          lifecycle = excluded.lifecycle,
          revision = excluded.revision,
          updated_at = excluded.updated_at;
      END;

CREATE TRIGGER database_module_receipts_immutable_update
      BEFORE UPDATE ON database_module_receipts
      BEGIN
        SELECT RAISE(ABORT, 'Database Module receipts are immutable');
      END;

CREATE TRIGGER block_mutations_validate_insert
      BEFORE INSERT ON block_mutations
      WHEN NEW.store_epoch <> COALESCE((
          SELECT store_epoch FROM block_store_metadata WHERE id = 1
        ), '')
        OR EXISTS (
          SELECT 1
          FROM json_each(NEW.target_block_ids_json) target
          WHERE target.type <> 'text' OR length(target.value) = 0
        )
        OR (
          SELECT COUNT(*) FROM json_each(NEW.target_block_ids_json)
        ) <> (
          SELECT COUNT(DISTINCT target.value)
          FROM json_each(NEW.target_block_ids_json) target
        )
        OR EXISTS (
          SELECT 1
          FROM json_each(NEW.field_intents_json) intent
          WHERE intent.type <> 'object'
            OR json_type(intent.value, '$.path') <> 'text'
            OR length(json_extract(intent.value, '$.path')) = 0
            OR json_type(intent.value, '$.operation') <> 'text'
            OR length(json_extract(intent.value, '$.operation')) = 0
        )
        OR (
          NEW.outcome = 'committed'
          AND (
            EXISTS (
              SELECT 1
              FROM json_each(NEW.target_block_ids_json) target
              WHERE NOT EXISTS (
                SELECT 1
                FROM blocks block
                WHERE block.id = target.value
                  AND EXISTS (
                    SELECT 1
                    FROM projects actor_project
                    INNER JOIN projects owner_project
                      ON owner_project.id = block.project_id
                     AND owner_project.library_id = actor_project.library_id
                    WHERE actor_project.id = NEW.project_id
                  )
              )
            )
            OR NOT EXISTS (
              SELECT 1
              FROM change_log change
              WHERE change.seq = NEW.change_log_seq
                AND change.project_id = NEW.project_id
                AND change.store_epoch = NEW.store_epoch
                AND change.operation_id = NEW.mutation_id
            )
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'block mutation scope, intent, or result cursor is invalid');
      END;

CREATE TRIGGER reminder_snoozes_require_page_insert
        BEFORE INSERT ON reminder_snoozes
        WHEN NOT EXISTS (
          SELECT 1
          FROM blocks page
          INNER JOIN projects actor_project
            ON actor_project.id = NEW.project_id
          INNER JOIN projects owner_project
            ON owner_project.id = page.project_id
           AND owner_project.library_id = actor_project.library_id
          WHERE page.id = NEW."page_id" AND page.type = 'page'
        )
        BEGIN
          SELECT RAISE(ABORT, 'reminder snooze target must be a Page in the Project Library');
        END;

CREATE TRIGGER reminder_snoozes_require_page_update
        BEFORE UPDATE OF "page_id", project_id ON reminder_snoozes
        WHEN NOT EXISTS (
          SELECT 1
          FROM blocks page
          INNER JOIN projects actor_project
            ON actor_project.id = NEW.project_id
          INNER JOIN projects owner_project
            ON owner_project.id = page.project_id
           AND owner_project.library_id = actor_project.library_id
          WHERE page.id = NEW."page_id" AND page.type = 'page'
        )
        BEGIN
          SELECT RAISE(ABORT, 'reminder snooze target must be a Page in the Project Library');
        END;

CREATE TRIGGER document_versions_are_immutable
      BEFORE UPDATE ON document_versions
      BEGIN
        SELECT RAISE(ABORT, 'document versions are immutable');
      END;

CREATE TRIGGER pages_validate_parent_insert
      BEFORE INSERT ON pages
      WHEN NOT (
        (NEW.parent_kind = 'library' AND EXISTS (
          SELECT 1 FROM libraries library
          WHERE library.id = NEW.parent_id AND library.id = NEW.library_id
        ))
        OR (NEW.parent_kind = 'page' AND NEW.parent_id <> NEW.block_id AND EXISTS (
          SELECT 1 FROM pages parent
          WHERE parent.block_id = NEW.parent_id
            AND parent.library_id = NEW.library_id
            AND parent.lifecycle <> 'deleted'
        ))
        OR (NEW.parent_kind = 'data_source' AND EXISTS (
          SELECT 1 FROM data_sources source
          WHERE source.id = NEW.parent_id
            AND source.library_id = NEW.library_id
            AND source.lifecycle <> 'deleted'
        ))
      )
      BEGIN
        SELECT RAISE(ABORT, 'Page parent must be an owned Library, Page, or Data Source');
      END;

CREATE TRIGGER pages_validate_hierarchy_insert
      BEFORE INSERT ON pages
      WHEN NEW.parent_kind = 'page' AND (
  NEW.parent_id = NEW.block_id
  OR EXISTS (
    WITH RECURSIVE ancestors(
      block_id, library_id, parent_kind, parent_id, lifecycle
    ) AS (
      SELECT block_id, library_id, parent_kind, parent_id, lifecycle
      FROM pages WHERE block_id = NEW.parent_id
      UNION
      SELECT parent.block_id, parent.library_id, parent.parent_kind,
        parent.parent_id, parent.lifecycle
      FROM ancestors current
      INNER JOIN pages parent
        ON current.parent_kind = 'page'
        AND parent.block_id = current.parent_id
    )
    SELECT 1
    WHERE EXISTS (
        SELECT 1 FROM ancestors WHERE block_id = NEW.block_id
      )
      OR (SELECT COUNT(*) FROM ancestors) >= 512
      OR EXISTS (
        SELECT 1 FROM ancestors
        WHERE library_id <> NEW.library_id OR lifecycle = 'deleted'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM ancestors terminal
        WHERE (
          terminal.parent_kind = 'library'
          AND EXISTS (
            SELECT 1 FROM libraries library
            WHERE library.id = terminal.parent_id
              AND library.id = NEW.library_id
          )
        ) OR (
          terminal.parent_kind = 'data_source'
          AND EXISTS (
            SELECT 1 FROM data_sources source
            WHERE source.id = terminal.parent_id
              AND source.library_id = NEW.library_id
              AND source.lifecycle <> 'deleted'
          )
        )
      )
  )
)
      BEGIN
        SELECT RAISE(ABORT, 'Page parent hierarchy must be acyclic and rooted');
      END;

CREATE TRIGGER pages_validate_parent_update
      BEFORE UPDATE OF library_id, parent_kind, parent_id ON pages
      WHEN NOT (
        (NEW.parent_kind = 'library' AND EXISTS (
          SELECT 1 FROM libraries library
          WHERE library.id = NEW.parent_id AND library.id = NEW.library_id
        ))
        OR (NEW.parent_kind = 'page' AND NEW.parent_id <> NEW.block_id AND EXISTS (
          SELECT 1 FROM pages parent
          WHERE parent.block_id = NEW.parent_id
            AND parent.library_id = NEW.library_id
            AND parent.lifecycle <> 'deleted'
        ))
        OR (NEW.parent_kind = 'data_source' AND EXISTS (
          SELECT 1 FROM data_sources source
          WHERE source.id = NEW.parent_id
            AND source.library_id = NEW.library_id
            AND source.lifecycle <> 'deleted'
        ))
      )
      BEGIN
        SELECT RAISE(ABORT, 'Page parent must be an owned Library, Page, or Data Source');
      END;

CREATE TRIGGER pages_validate_hierarchy_update
      BEFORE UPDATE OF library_id, parent_kind, parent_id ON pages
      WHEN NEW.parent_kind = 'page' AND (
  NEW.parent_id = NEW.block_id
  OR EXISTS (
    WITH RECURSIVE ancestors(
      block_id, library_id, parent_kind, parent_id, lifecycle
    ) AS (
      SELECT block_id, library_id, parent_kind, parent_id, lifecycle
      FROM pages WHERE block_id = NEW.parent_id
      UNION
      SELECT parent.block_id, parent.library_id, parent.parent_kind,
        parent.parent_id, parent.lifecycle
      FROM ancestors current
      INNER JOIN pages parent
        ON current.parent_kind = 'page'
        AND parent.block_id = current.parent_id
    )
    SELECT 1
    WHERE EXISTS (
        SELECT 1 FROM ancestors WHERE block_id = NEW.block_id
      )
      OR (SELECT COUNT(*) FROM ancestors) >= 512
      OR EXISTS (
        SELECT 1 FROM ancestors
        WHERE library_id <> NEW.library_id OR lifecycle = 'deleted'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM ancestors terminal
        WHERE (
          terminal.parent_kind = 'library'
          AND EXISTS (
            SELECT 1 FROM libraries library
            WHERE library.id = terminal.parent_id
              AND library.id = NEW.library_id
          )
        ) OR (
          terminal.parent_kind = 'data_source'
          AND EXISTS (
            SELECT 1 FROM data_sources source
            WHERE source.id = terminal.parent_id
              AND source.library_id = NEW.library_id
              AND source.lifecycle <> 'deleted'
          )
        )
      )
  )
)
      BEGIN
        SELECT RAISE(ABORT, 'Page parent hierarchy must be acyclic and rooted');
      END;

CREATE TRIGGER pages_validate_document_insert
      BEFORE INSERT ON pages
      WHEN NOT EXISTS (
        SELECT 1 FROM block_documents ownership
        WHERE ownership.block_id = NEW.block_id
          AND ownership.document_id = NEW.document_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Page must own its declared Document');
      END;

CREATE TRIGGER pages_validate_document_update
      BEFORE UPDATE OF block_id, document_id ON pages
      WHEN NOT EXISTS (
        SELECT 1 FROM block_documents ownership
        WHERE ownership.block_id = NEW.block_id
          AND ownership.document_id = NEW.document_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Page must own its declared Document');
      END;

CREATE TRIGGER library_content_relocations_validate_insert
      BEFORE INSERT ON library_content_relocations
      WHEN NOT EXISTS (
        SELECT 1
        FROM projects actor
        INNER JOIN projects source ON source.id = NEW.source_project_id
        INNER JOIN projects target ON target.id = NEW.target_project_id
        INNER JOIN block_store_metadata metadata ON metadata.id = 1
        WHERE actor.id = NEW.actor_project_id
          AND actor.library_id = NEW.library_id
          AND source.library_id = NEW.library_id
          AND target.library_id = NEW.library_id
          AND actor.lifecycle = 'active'
          AND source.lifecycle <> 'archived'
          AND target.lifecycle = 'active'
          AND metadata.store_epoch = NEW.store_epoch
      )
      BEGIN
        SELECT RAISE(ABORT, 'Library content relocation coordinates are invalid');
      END;

CREATE TRIGGER database_containers_default_view_is_owned_insert
      BEFORE INSERT ON database_containers
      WHEN NEW.default_view_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM database_views view
          WHERE view.id = NEW.default_view_id
            AND view.database_block_id = NEW.block_id
            AND view.lifecycle = 'active'
        )
      BEGIN
        SELECT RAISE(ABORT, 'Database default View must be active and owned by its Container');
      END;

CREATE TRIGGER database_containers_default_view_is_owned_update
      BEFORE UPDATE OF default_view_id, block_id ON database_containers
      WHEN NEW.default_view_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM database_views view
          WHERE view.id = NEW.default_view_id
            AND view.database_block_id = NEW.block_id
            AND view.lifecycle = 'active'
        )
      BEGIN
        SELECT RAISE(ABORT, 'Database default View must be active and owned by its Container');
      END;

CREATE TRIGGER database_views_preserve_container_default_update
      BEFORE UPDATE OF database_block_id, lifecycle ON database_views
      WHEN EXISTS (
        SELECT 1 FROM database_containers container
        WHERE container.default_view_id = OLD.id
          AND (NEW.database_block_id <> container.block_id OR NEW.lifecycle <> 'active')
      )
      BEGIN
        SELECT RAISE(ABORT, 'A Database default View must remain active and owned');
      END;

CREATE TRIGGER database_views_preserve_container_default_delete
      BEFORE DELETE ON database_views
      WHEN EXISTS (
        SELECT 1 FROM database_containers container
        WHERE container.default_view_id = OLD.id
      )
      BEGIN
        SELECT RAISE(ABORT, 'A Database default View cannot be deleted');
      END;

CREATE TRIGGER database_view_page_positions_require_active_membership_insert
      BEFORE INSERT ON database_view_page_positions
      WHEN NOT EXISTS (
        SELECT 1
        FROM database_views view
        INNER JOIN data_source_page_memberships membership
          ON membership.data_source_id = view.data_source_id
         AND membership.page_block_id = NEW.page_block_id
         AND membership.removed_at IS NULL
        WHERE view.id = NEW.view_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Database View position requires active Source membership');
      END;

CREATE TRIGGER database_view_page_positions_require_active_membership_update
      BEFORE UPDATE OF view_id, page_block_id ON database_view_page_positions
      WHEN NOT EXISTS (
        SELECT 1
        FROM database_views view
        INNER JOIN data_source_page_memberships membership
          ON membership.data_source_id = view.data_source_id
         AND membership.page_block_id = NEW.page_block_id
         AND membership.removed_at IS NULL
        WHERE view.id = NEW.view_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Database View position requires active Source membership');
      END;

CREATE TRIGGER blocks_identity_is_immutable
      BEFORE UPDATE OF id ON blocks
      WHEN NEW.id IS NOT OLD.id
      BEGIN
        SELECT RAISE(ABORT, 'Block identity is immutable');
      END;

CREATE TRIGGER blocks_non_space_location_has_no_top_level_placement
      BEFORE UPDATE OF location_kind, containing_document_id, containing_database_id
      ON blocks
      WHEN NEW.location_kind <> 'space'
        AND EXISTS (
          SELECT 1 FROM top_level_block_placements placement
          WHERE placement.block_id = NEW.id
        )
      BEGIN
        SELECT RAISE(ABORT, 'non-space block location cannot retain a top-level placement');
      END;

CREATE TRIGGER blocks_reject_retired_identity
      BEFORE INSERT ON blocks
      WHEN EXISTS (
        SELECT 1 FROM retired_block_identities retired
        WHERE retired.block_id = NEW.id
      )
      BEGIN
        SELECT RAISE(ABORT, 'retired Block identity cannot be reused');
      END;

CREATE TRIGGER blocks_type_updates_preserve_document_ownership
        BEFORE UPDATE OF type ON blocks
        WHEN NEW.type <> OLD.type
          AND EXISTS (
            SELECT 1 FROM block_documents ownership
            WHERE ownership.block_id = OLD.id
          )
        BEGIN
          SELECT RAISE(ABORT, 'document owner type changes require a typed ownership operation');
        END;

CREATE TRIGGER page_behavior_records_guard_block_retype
        BEFORE UPDATE OF type ON blocks
        WHEN NEW.type <> 'page'
          AND (
            EXISTS (
              SELECT 1 FROM recurrence_exceptions behavior
              WHERE behavior."page_id" = OLD.id
                AND behavior.project_id = OLD.project_id
            )
            OR EXISTS (
              SELECT 1 FROM reminder_receipts behavior
              WHERE behavior."page_id" = OLD.id
                AND behavior.project_id = OLD.project_id
            )
            OR EXISTS (
              SELECT 1 FROM reminder_snoozes behavior
              WHERE behavior."page_id" = OLD.id
            )
            OR EXISTS (
              SELECT 1 FROM "scheduled_page_index" behavior
              WHERE behavior."page_block_id" = OLD.id
                AND behavior.project_id = OLD.project_id
            )
          )
        BEGIN
          SELECT RAISE(ABORT, 'a Block with Page behavior dependencies must remain type page');
        END;

CREATE TRIGGER page_read_model_validate_insert
      BEFORE INSERT ON page_read_model
      WHEN NOT EXISTS (
        SELECT 1 FROM blocks page
        WHERE page.id = NEW.page_block_id
          AND page.project_id = NEW.project_id
          AND page.type = 'page'
      ) OR (
        NEW.membership_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM data_source_page_memberships membership
          INNER JOIN data_sources source ON source.id = membership.data_source_id
          WHERE membership.id = NEW.membership_id
            AND membership.page_block_id = NEW.page_block_id
            AND membership.removed_at IS NULL
            AND source.home_database_block_id = NEW.database_block_id
        )
      ) OR (
        NEW.view_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM database_views view
          INNER JOIN data_source_page_memberships membership
            ON membership.id = NEW.membership_id
           AND membership.data_source_id = view.data_source_id
          WHERE view.id = NEW.view_id
            AND view.database_block_id = NEW.database_block_id
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'Page read model source coordinates are invalid or stale');
      END;

CREATE TRIGGER page_read_model_validate_update
      BEFORE UPDATE ON page_read_model
      WHEN NOT EXISTS (
        SELECT 1 FROM blocks page
        WHERE page.id = NEW.page_block_id
          AND page.project_id = NEW.project_id
          AND page.type = 'page'
      ) OR (
        NEW.membership_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM data_source_page_memberships membership
          INNER JOIN data_sources source ON source.id = membership.data_source_id
          WHERE membership.id = NEW.membership_id
            AND membership.page_block_id = NEW.page_block_id
            AND membership.removed_at IS NULL
            AND source.home_database_block_id = NEW.database_block_id
        )
      ) OR (
        NEW.view_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM database_views view
          INNER JOIN data_source_page_memberships membership
            ON membership.id = NEW.membership_id
           AND membership.data_source_id = view.data_source_id
          WHERE view.id = NEW.view_id
            AND view.database_block_id = NEW.database_block_id
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'Page read model source coordinates are invalid or stale');
      END;

CREATE TRIGGER database_containers_require_database_block_insert
      BEFORE INSERT ON database_containers
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks block
        INNER JOIN projects project ON project.id = block.project_id
        WHERE block.id = NEW.block_id
          AND block.type = 'database'
          AND project.library_id = NEW.library_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Database Container must match a Database Block in its Library');
      END;

CREATE TRIGGER database_containers_require_database_block_update
      BEFORE UPDATE OF block_id, library_id ON database_containers
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks block
        INNER JOIN projects project ON project.id = block.project_id
        WHERE block.id = NEW.block_id
          AND block.type = 'database'
          AND project.library_id = NEW.library_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Database Container must match a Database Block in its Library');
      END;

CREATE TRIGGER data_sources_require_container_library_insert
      BEFORE INSERT ON data_sources
      WHEN NOT EXISTS (
        SELECT 1 FROM database_containers container
        WHERE container.block_id = NEW.home_database_block_id
          AND container.library_id = NEW.library_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Data Source must share its Database Container Library');
      END;

CREATE TRIGGER data_sources_require_container_library_update
      BEFORE UPDATE OF library_id, home_database_block_id ON data_sources
      WHEN NOT EXISTS (
        SELECT 1 FROM database_containers container
        WHERE container.block_id = NEW.home_database_block_id
          AND container.library_id = NEW.library_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Data Source must share its Database Container Library');
      END;

CREATE TRIGGER blocks_type_updates_preserve_database_containers
      BEFORE UPDATE OF type ON blocks
      WHEN NEW.type <> 'database'
        AND EXISTS (
          SELECT 1 FROM database_containers container
          WHERE container.block_id = OLD.id
        )
      BEGIN
        SELECT RAISE(ABORT, 'Database Block type cannot change while its Container exists');
      END;

CREATE TRIGGER data_source_memberships_require_page_block_insert
      BEFORE INSERT ON data_source_page_memberships
      WHEN NEW.removed_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks page
          INNER JOIN data_sources source ON source.id = NEW.data_source_id
          WHERE page.id = NEW.page_block_id
            AND page.type = 'page'
            AND page.location_kind = 'database'
            AND page.containing_database_id = source.home_database_block_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'Active Source membership must match the Page Database parent');
      END;

CREATE TRIGGER data_source_memberships_require_page_block_update
      BEFORE UPDATE OF data_source_id, page_block_id, removed_at
      ON data_source_page_memberships
      WHEN NEW.removed_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks page
          INNER JOIN data_sources source ON source.id = NEW.data_source_id
          WHERE page.id = NEW.page_block_id
            AND page.type = 'page'
            AND page.location_kind = 'database'
            AND page.containing_database_id = source.home_database_block_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'Active Source membership must match the Page Database parent');
      END;

CREATE TRIGGER blocks_active_source_membership_requires_database_location
      BEFORE UPDATE OF type, location_kind, containing_document_id,
        containing_database_id ON blocks
      WHEN EXISTS (
        SELECT 1
        FROM data_source_page_memberships membership
        INNER JOIN data_sources source ON source.id = membership.data_source_id
        WHERE membership.page_block_id = OLD.id
          AND membership.removed_at IS NULL
          AND (
            NEW.type <> 'page'
            OR NEW.location_kind <> 'database'
            OR NEW.containing_document_id IS NOT NULL
            OR NEW.containing_database_id IS NOT source.home_database_block_id
          )
      )
      BEGIN
        SELECT RAISE(ABORT, 'Page location cannot diverge from its active Source membership');
      END;

CREATE TRIGGER data_source_property_values_require_matching_type_insert
      BEFORE INSERT ON data_source_property_values
      WHEN NOT EXISTS (
        SELECT 1 FROM data_source_properties property
        WHERE property.data_source_id = NEW.data_source_id
          AND property.id = NEW.property_id
          AND property.value_type = NEW.value_type
          AND property.lifecycle = 'active'
      )
      BEGIN
        SELECT RAISE(ABORT, 'Data Source Property value must match an active Property type');
      END;

CREATE TRIGGER data_source_property_values_require_matching_type_update
      BEFORE UPDATE OF data_source_id, property_id, value_type
      ON data_source_property_values
      WHEN NOT EXISTS (
        SELECT 1 FROM data_source_properties property
        WHERE property.data_source_id = NEW.data_source_id
          AND property.id = NEW.property_id
          AND property.value_type = NEW.value_type
          AND property.lifecycle = 'active'
      )
      BEGIN
        SELECT RAISE(ABORT, 'Data Source Property value must match an active Property type');
      END;

CREATE TRIGGER block_mutations_are_immutable
      BEFORE UPDATE ON block_mutations
      BEGIN
        SELECT RAISE(ABORT, 'block mutations are immutable');
      END;

CREATE TRIGGER change_log_is_immutable
      BEFORE UPDATE ON change_log
      BEGIN
        SELECT RAISE(ABORT, 'change log entries are immutable');
      END;

CREATE TRIGGER nodex_agent_committed_call_receipts_cannot_delete
    BEFORE DELETE ON nodex_agent_call_receipts
    WHEN OLD.status = 'committed'
    BEGIN
      SELECT RAISE(ABORT, 'Committed Nodex Agent call receipts are immutable');
    END;

CREATE TRIGGER canvas_scene_mutation_receipts_validate_result_hash_insert
      BEFORE INSERT ON canvas_scene_mutation_receipts
      WHEN length(NEW.result_hash) <> 64
        OR NEW.result_hash GLOB '*[^0-9a-f]*'
      BEGIN
        SELECT RAISE(ABORT, 'Canvas scene mutation result hash is invalid');
      END;

PRAGMA user_version = 82;
COMMIT;
PRAGMA foreign_keys = ON;
