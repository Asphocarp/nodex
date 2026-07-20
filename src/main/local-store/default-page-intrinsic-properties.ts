import type Database from "better-sqlite3";

export const DEFAULT_PAGE_INTRINSIC_PROPERTIES = [
  ["run.target", "string", "localProject"],
  ["run.localPath", "string", null],
  ["run.baseBranch", "string", null],
  ["run.worktreePath", "string", null],
  ["run.environmentPath", "string", null],
  ["schedule.isAllDay", "boolean", false],
  ["schedule.timezone", "string", null],
  ["recurrence.config", "json", null],
  ["reminders.config", "json", []],
] as const;

export const insertDefaultPageIntrinsicProperties = (
  database: Database.Database,
  input: Readonly<{
    pageId: string;
    projectId: string;
    now: string;
  }>,
): void => {
  const insert = database.prepare(`
    INSERT INTO block_properties (
      block_id, project_id, property_key, value_type,
      value_json, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  for (const [key, valueType, value] of DEFAULT_PAGE_INTRINSIC_PROPERTIES) {
    insert.run(
      input.pageId,
      input.projectId,
      key,
      valueType,
      JSON.stringify(value),
      input.now,
    );
  }
};
