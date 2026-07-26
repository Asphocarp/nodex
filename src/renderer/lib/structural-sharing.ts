/**
 * Structural sharing for derived state.
 *
 * `replaceEqualDeep(prev, next)` returns `next` with every subtree that is
 * deeply equal to the matching subtree of `prev` replaced by the `prev`
 * reference. When the whole value is semantically unchanged the exact `prev`
 * reference comes back, so `Object.is`-based stores and effect dependencies
 * can bail out instead of re-rendering.
 *
 * Reconcile-style updaters (effects that recompute state from external data)
 * must route their result through this helper: a semantic no-op that returns a
 * fresh object identity re-enters React and can feed a render loop.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function replaceEqualDeep<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return prev as T;

  if (Array.isArray(prev) && Array.isArray(next)) {
    const merged: unknown[] = new Array(next.length);
    let sharedCount = 0;
    for (let index = 0; index < next.length; index += 1) {
      merged[index] = replaceEqualDeep(prev[index], next[index]);
      if (merged[index] === prev[index]) sharedCount += 1;
    }
    return prev.length === next.length && sharedCount === next.length
      ? (prev as unknown as T)
      : (merged as unknown as T);
  }

  if (isPlainObject(prev) && isPlainObject(next)) {
    const nextKeys = Object.keys(next);
    const merged: Record<string, unknown> = {};
    let sharedCount = 0;
    for (const key of nextKeys) {
      merged[key] = replaceEqualDeep(prev[key], next[key]);
      if (key in prev && merged[key] === prev[key]) sharedCount += 1;
    }
    return Object.keys(prev).length === nextKeys.length
      && sharedCount === nextKeys.length
      ? (prev as T)
      : (merged as T);
  }

  return next;
}
