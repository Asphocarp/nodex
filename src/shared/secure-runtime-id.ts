export type RandomUuidFactory = () => string;

/** Creates a collision-resistant UUID and fails closed when Web Crypto is unavailable. */
export function createSecureUuid(
  randomUuid: RandomUuidFactory = () => globalThis.crypto.randomUUID(),
): string {
  return randomUuid();
}

export function createSecureRuntimeId(
  prefix: string,
  randomUuid: RandomUuidFactory = () => globalThis.crypto.randomUUID(),
): string {
  return `${prefix}:${createSecureUuid(randomUuid)}`;
}
