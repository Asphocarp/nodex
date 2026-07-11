import { describe, expect, test } from "vitest";
import {
  bindDatabaseMutationToProject,
  parseDatabaseMutationCommandResult,
  parseDatabaseReadCommandResult,
  parsePrimaryDatabaseViewSnapshotCommandResult,
} from "./database-transport";

const fails = (run: () => void): boolean => {
  try {
    run();
    return false;
  } catch {
    return true;
  }
};

describe("Database transport codecs", () => {
  test("binds audit attribution to the trusted host identity", () => {
    const bound = bindDatabaseMutationToProject(
      {
        version: 1,
        operationId: "trusted-binding",
        projectId: "project-1",
        storeEpoch: "epoch-1",
        clientSessionId: "spoofed-session",
        actor: { kind: "spoofed-actor" },
        operations: [
          {
            kind: "position_card",
            viewId: "view-1",
            cardBlockId: "card-1",
            expectedPositionRevision: 1,
            groupKey: null,
          },
        ],
      },
      "project-1",
      {
        clientSessionId: "trusted-session",
        actor: { kind: "electron_renderer", clientId: "window-1" },
      },
    );
    expect(bound.ok ? bound.value.clientSessionId : "error").toBe(
      "trusted-session",
    );
    expect(bound.ok ? bound.value.actor.kind : "error").toBe(
      "electron_renderer",
    );
  });

  test("keeps timestamps as exact strings and rejects non-JSON read payloads", () => {
    const parsed = parseDatabaseReadCommandResult<{
      readonly updatedAt: string;
    }>({
      ok: true,
      value: {
        version: 1,
        projectId: "project-1",
        storeEpoch: "epoch-1",
        changeLogSeq: 0,
        value: { updatedAt: "2026-07-11T08:00:00.000Z" },
      },
    });
    expect(parsed.ok ? parsed.value.value?.updatedAt : "error").toBe(
      "2026-07-11T08:00:00.000Z",
    );
    expect(
      fails(() =>
        parseDatabaseReadCommandResult({
          ok: true,
          value: {
            version: 1,
            projectId: "project-1",
            storeEpoch: "epoch-1",
            changeLogSeq: 0,
            value: { binary: new Uint8Array([1, 2, 3]) },
          },
        }),
      ),
    ).toBe(true);
    expect(
      fails(() =>
        parseDatabaseReadCommandResult({
          ok: true,
          value: {
            version: 1,
            projectId: "project-1",
            storeEpoch: "epoch-1",
            changeLogSeq: 0,
            value: { date: new Date("2026-07-11T08:00:00.000Z") },
          },
        }),
      ),
    ).toBe(true);
  });

  test("parses exact multi-operation receipts", () => {
    const result = parseDatabaseMutationCommandResult({
      ok: true,
      value: {
        version: 1,
        operationId: "operation-1",
        projectId: "project-1",
        storeEpoch: "epoch-1",
        operationKinds: ["set_value", "position_card"],
        affectedDatabaseBlockIds: ["database-1"],
        duplicate: false,
        payload: { operationResults: [] },
        changeLogSeq: 4,
        committedAt: "2026-07-11T08:00:00.000Z",
      },
    });
    expect(result.ok ? result.value.operationKinds.join(",") : "error").toBe(
      "set_value,position_card",
    );
  });

  test("accepts only a primary View snapshot captured under one cursor", () => {
    const read = (changeLogSeq: number) => ({
      version: 1,
      projectId: "project-1",
      storeEpoch: "epoch-1",
      changeLogSeq,
      value: null,
    });
    const parsed = parsePrimaryDatabaseViewSnapshotCommandResult({
      ok: true,
      value: {
        descriptor: read(7),
        query: read(7),
      },
    });
    expect(parsed.ok ? parsed.value.descriptor.changeLogSeq : -1).toBe(7);
    expect(
      fails(() =>
        parsePrimaryDatabaseViewSnapshotCommandResult({
          ok: true,
          value: {
            descriptor: read(7),
            query: read(8),
          },
        }),
      ),
    ).toBe(true);
  });
});
