import { describe, expect, test } from "vitest";
import {
  insertOrderedStringIdsAfter,
  removeOrderedStringIds,
  upsertOrderedStringIds,
} from "./codex-turn-order";

describe("codex turn order helpers", () => {
  test("appends missing ids without duplicating existing order entries", () => {
    const result = upsertOrderedStringIds(["user_1", "exec_1"], ["exec_1", "steer_1", "steer_1"]);

    expect(result.join(",")).toBe("user_1,exec_1,steer_1");
  });

  test("inserts ids after an anchor while preserving surrounding order", () => {
    const result = insertOrderedStringIdsAfter(["user_1", "steer_1", "assistant_1"], "steer_1", [
      "steered_1",
    ]);

    expect(result.join(",")).toBe("user_1,steer_1,steered_1,assistant_1");
  });

  test("moves existing ids to the requested anchor position", () => {
    const result = insertOrderedStringIdsAfter(
      ["user_1", "steered_1", "steer_1", "assistant_1"],
      "steer_1",
      ["steered_1"],
    );

    expect(result.join(",")).toBe("user_1,steer_1,steered_1,assistant_1");
  });

  test("appends inserted ids when the anchor is missing", () => {
    const result = insertOrderedStringIdsAfter(["user_1"], "missing", ["steer_1", "steered_1"]);

    expect(result.join(",")).toBe("user_1,steer_1,steered_1");
  });

  test("removes all requested ids", () => {
    const result = removeOrderedStringIds(
      ["user_1", "steer_1", "steered_1"],
      ["steer_1", "missing"],
    );

    expect(result.join(",")).toBe("user_1,steered_1");
  });
});
