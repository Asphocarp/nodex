import { describe, expect, test } from "vite-plus/test";
import {
  BackupScheduleFormSchema,
  HistoryRetentionFormSchema,
  ManualSnapshotFormSchema,
} from "./workbench-settings-form-schemas";

describe("workbench settings form schemas", () => {
  test("parses backup schedule strings into numeric settings payloads", () => {
    const parsed = BackupScheduleFormSchema.parse({
      autoEnabled: true,
      intervalHours: "12",
      retentionCount: "30",
      retentionGiB: "64",
    });

    expect(JSON.stringify(parsed)).toBe(
      JSON.stringify({
        autoEnabled: true,
        intervalHours: 12,
        retentionCount: 30,
        retentionGiB: 64,
      }),
    );
  });

  test("rejects invalid backup frequency text", () => {
    const parsed = BackupScheduleFormSchema.safeParse({
      autoEnabled: true,
      intervalHours: "0",
      retentionCount: "30",
      retentionGiB: "64",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message ?? "").toBe("Frequency must be an integer >= 1.");
  });

  test("parses history retention and trims manual snapshot labels", () => {
    const history = HistoryRetentionFormSchema.parse({
      retentionCount: "1000",
    });
    const snapshot = ManualSnapshotFormSchema.parse({
      label: "  Before risky restore  ",
    });

    expect(JSON.stringify(history)).toBe(
      JSON.stringify({
        retentionCount: 1000,
      }),
    );
    expect(JSON.stringify(snapshot)).toBe(
      JSON.stringify({
        label: "Before risky restore",
      }),
    );
  });
});
