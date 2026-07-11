import { describe, expect, test } from "vitest";

import type { BlockPropertyJsonValue } from "./block-property-mutations";
import {
  CardMetadataPropertyCompilerError,
  compileCardMetadataPropertyMutation,
  type CardMetadataPropertyCoordinate,
  type CardMetadataPropertySnapshot,
} from "./card-metadata-property-compiler";

const databaseCoordinate = (
  field: Extract<
    CardMetadataPropertyCoordinate,
    { readonly scope: "database" }
  >["field"],
  revision: number,
  value: BlockPropertyJsonValue,
): CardMetadataPropertyCoordinate => ({
  scope: "database",
  field,
  databaseBlockId: "database-1",
  propertyId: `property-${field}`,
  revision,
  value,
});

const intrinsicCoordinate = (
  field: Extract<
    CardMetadataPropertyCoordinate,
    { readonly scope: "intrinsic" }
  >["field"],
  revision: number,
  value: BlockPropertyJsonValue,
): CardMetadataPropertyCoordinate => ({
  scope: "intrinsic",
  field,
  revision,
  value,
});

const snapshot = (
  fields: readonly CardMetadataPropertyCoordinate[],
): CardMetadataPropertySnapshot => ({
  projectId: "project-1",
  storeEpoch: "epoch-1",
  changeLogSeq: 10,
  cardBlockId: "card-1",
  metadataRevision: 7,
  fields,
});

const compile = (
  value: CardMetadataPropertySnapshot,
  patch: Parameters<typeof compileCardMetadataPropertyMutation>[0]["patch"],
) =>
  compileCardMetadataPropertyMutation({
    mutationId: "mutation-1",
    clientSessionId: "window-1",
    actor: { kind: "test" },
    snapshot: value,
    patch,
  });

const readCompilerError = (operation: () => unknown): string | null => {
  try {
    operation();
    return null;
  } catch (error) {
    return error instanceof CardMetadataPropertyCompilerError
      ? error.message
      : "unexpected";
  }
};

describe("Card metadata property compatibility compiler", () => {
  test("maps a mixed CardInput patch to one revision-complete property batch", () => {
    const request = compile(
      snapshot([
        databaseCoordinate("priority", 3, "p2-medium"),
        databaseCoordinate("dueDate", 5, null),
        intrinsicCoordinate("agentStatus", 8, null),
        intrinsicCoordinate("runInTarget", 2, "localProject"),
      ]),
      {
        priority: "p0-critical",
        dueDate: new Date("2026-07-20T12:30:00.000Z"),
        agentStatus: " running ",
        runInTarget: "newWorktree",
      },
    );

    expect(request.projectId).toBe("project-1");
    expect(request.storeEpoch).toBe("epoch-1");
    expect(request.fields.length).toBe(4);
    const priority = request.fields.find(
      (field) => field.scope === "database" && field.propertyId === "property-priority",
    );
    expect(priority?.operation).toBe("set");
    expect(priority?.operation === "set" ? priority.expectedRevision : -1).toBe(3);
    expect(priority?.operation === "set" ? priority.value : null).toBe(
      "p0-critical",
    );
    const dueDate = request.fields.find(
      (field) => field.scope === "database" && field.propertyId === "property-dueDate",
    );
    expect(dueDate?.operation === "set" ? dueDate.value : null).toBe(
      "2026-07-20",
    );
    const agentStatus = request.fields.find(
      (field) =>
        field.scope === "intrinsic" && field.propertyKey === "agent.status",
    );
    expect(agentStatus?.operation === "set" ? agentStatus.expectedRevision : -1).toBe(8);
    expect(agentStatus?.operation === "set" ? agentStatus.value : null).toBe(
      "running",
    );
  });

  test("preserves tag add/remove intent from the captured snapshot", () => {
    const request = compile(
      snapshot([databaseCoordinate("tags", 11, ["alpha", "legacy"])]),
      { tags: ["beta", "alpha", "beta"] },
    );
    const tags = request.fields[0];

    expect(tags?.operation).toBe("add_remove");
    expect(tags?.operation === "add_remove" ? tags.add.join(",") : "").toBe(
      "beta",
    );
    expect(
      tags?.operation === "add_remove" ? tags.remove.join(",") : "",
    ).toBe("legacy");
  });

  test("rejects Document, lifecycle, undefined, and semantic no-op patches", () => {
    const current = snapshot([
      databaseCoordinate("priority", 1, "p2-medium"),
    ]);

    expect(
      readCompilerError(() => compile(current, { title: "Document title" })),
    ).toBe("Card title belongs to the Card Document, not metadata");
    expect(
      readCompilerError(() =>
        compile(current, { archived: true } as never),
      )?.includes("CardLifecycleMutation") ?? false,
    ).toBe(true);
    expect(
      readCompilerError(() => compile(current, { priority: undefined })),
    ).toBe("Card priority must be omitted instead of undefined");
    expect(
      readCompilerError(() => compile(current, { priority: "p2-medium" })),
    ).toBe("Card metadata patch has no semantic changes");
  });

  test("accepts only boolean-or-null isAllDay compatibility values", () => {
    const current = snapshot([
      intrinsicCoordinate("isAllDay", 4, true),
    ]);
    const request = compile(current, { isAllDay: null });

    expect(request.fields[0]?.operation).toBe("set");
    expect(
      request.fields[0]?.operation === "set"
        ? request.fields[0].value
        : null,
    ).toBe(false);
    expect(
      readCompilerError(() =>
        compile(current, { isAllDay: "false" } as never),
      ),
    ).toBe("Card isAllDay must be a boolean or null");
  });
});
