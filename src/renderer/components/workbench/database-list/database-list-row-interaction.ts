import type { DatabaseListDropPosition } from "./compile-list-drop-intent";

/**
 * Resolves pointer intent separately from the semantic drop compiler.
 * Ordinary row drops are reorder-only; nesting requires the explicit Option/Alt gesture.
 */
export const resolveDatabaseListRowDropPosition = (input: {
  readonly clientY: number;
  readonly rowTop: number;
  readonly rowHeight: number;
  readonly explicitNest: boolean;
}): Exclude<DatabaseListDropPosition, "root"> => {
  if (input.explicitNest) return "nest";
  if (input.rowHeight <= 0) return "after";
  return input.clientY < input.rowTop + input.rowHeight / 2
    ? "before"
    : "after";
};
