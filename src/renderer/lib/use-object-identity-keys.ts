import { useId, useRef } from "react";

/**
 * Gives immutable domain objects renderer-local identity without polluting their
 * persisted shape. Unchanged objects keep their key through insertion, removal,
 * and reordering; an immutable replacement intentionally receives a new key.
 */
export function useObjectIdentityKey(): (item: object) => string {
  const namespace = useId();
  const nextOrdinalRef = useRef(0);
  const keysByObjectRef = useRef(new WeakMap<object, string>());

  return (item) => {
    const existing = keysByObjectRef.current.get(item);
    if (existing) return existing;

    const key = `${namespace}:object:${nextOrdinalRef.current}`;
    nextOrdinalRef.current += 1;
    keysByObjectRef.current.set(item, key);
    return key;
  };
}
