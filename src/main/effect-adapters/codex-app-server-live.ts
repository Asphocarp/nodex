/** Live nondeterminism kept outside the reconnect policy for deterministic tests. */
export const codexReconnectJitter = (): number => Math.floor(Math.random() * 250);
