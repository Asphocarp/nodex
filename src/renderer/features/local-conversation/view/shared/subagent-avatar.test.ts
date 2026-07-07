import { describe, expect, test } from "bun:test";
import { buildSubagentAvatarIdenticon } from "./subagent-avatar";

describe("subagent avatar identicon", () => {
  test("builds deterministic mirrored 5x5 scan cells from a thread id", () => {
    const identicon = buildSubagentAvatarIdenticon("019f3c6a-2ebc-7b82-ab83-cb7edb449ada");
    const repeated = buildSubagentAvatarIdenticon("019f3c6a-2ebc-7b82-ab83-cb7edb449ada");
    const other = buildSubagentAvatarIdenticon("thread-nash");

    expect(JSON.stringify(identicon)).toBe(JSON.stringify(repeated));
    expect(JSON.stringify(identicon) === JSON.stringify(other)).toBeFalse();
    expect(identicon.cells.length > 0).toBeTrue();
    expect(identicon.scanCells.length).toBe(25);
    expect(identicon.color.startsWith("var(--color-token-charts-")).toBeTrue();

    const filledKeys = new Set(identicon.cells.map((cell) => `${cell.row}:${cell.column}`));
    let missingMirrors = "";
    for (const cell of identicon.cells) {
      const mirroredColumn = 4 - cell.column;
      if (!filledKeys.has(`${cell.row}:${mirroredColumn}`)) {
        missingMirrors += `${cell.row}:${cell.column};`;
      }
    }
    expect(missingMirrors).toBe("");
  });
});
