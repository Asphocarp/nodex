export function mergeOrderedStringIds(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  if (existing.length === 0) return [...incoming];
  if (incoming.length === 0) return [...existing];

  const merged = [...existing];
  const seen = new Set(existing);

  for (const id of incoming) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }

  return merged;
}

export function upsertOrderedStringId(
  existing: readonly string[],
  id: string,
): string[] {
  return existing.includes(id) ? [...existing] : [...existing, id];
}
