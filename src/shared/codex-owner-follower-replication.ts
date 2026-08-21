import type {
  CodexConversationSnapshot,
  CodexThreadOwnerStreamStatePublishInput,
  CodexThreadOwnerStreamStatePublishResult,
  CodexThreadStreamCheckpoint,
} from "./types";
import { applyCodexConversationStateUpdates } from "./codex-conversation-patches";

const SHA_256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA_256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256(value: string): string {
  const input = new TextEncoder().encode(value);
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;

  const view = new DataView(bytes.buffer);
  const highBits = Math.floor(bitLength / 0x1_0000_0000);
  const lowBits = bitLength >>> 0;
  view.setUint32(paddedLength - 8, highBits, false);
  view.setUint32(paddedLength - 4, lowBits, false);

  const state: [number, number, number, number, number, number, number, number] = [
    ...SHA_256_INITIAL_STATE,
  ];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0;
      const previous2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const upperSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h + upperSigma1 + choice + (SHA_256_ROUND_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>>
        0;
      const upperSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (upperSigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function stableStringify(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("Cannot checkpoint a cyclic conversation document");
    seen.add(value);
    const serialized = value
      .map((entry) => (entry === undefined ? "null" : stableStringify(entry, seen)))
      .join(",");
    seen.delete(value);
    return `[${serialized}]`;
  }
  if (typeof value !== "object") {
    throw new Error(`Cannot checkpoint unsupported ${typeof value} value`);
  }
  if (seen.has(value)) throw new Error("Cannot checkpoint a cyclic conversation document");
  seen.add(value);
  const record = value as Record<string, unknown>;
  const serialized = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], seen)}`)
    .join(",");
  seen.delete(value);
  return `{${serialized}}`;
}

function buildSharedReplicationDocument(
  conversation: CodexConversationSnapshot,
): CodexConversationSnapshot {
  const requests = conversation.requests.filter(
    (request) => request.type !== "nodexAgentAuthorization",
  );
  const {
    hasUnreadTurn: _hasUnreadTurn,
    unreadMessageCount: _unreadMessageCount,
    ...shared
  } = conversation;
  void _hasUnreadTurn;
  void _unreadMessageCount;
  return {
    ...shared,
    requests,
  } as CodexConversationSnapshot;
}

export function hashCodexConversationReplica(conversation: CodexConversationSnapshot): string {
  return sha256(serializeCodexConversationReplica(conversation));
}

export function serializeCodexConversationReplica(conversation: CodexConversationSnapshot): string {
  return stableStringify(buildSharedReplicationDocument(conversation), new Set());
}

export function buildCodexThreadStreamCheckpoint(input: {
  ownerEpoch: number;
  revision: number;
  conversation: CodexConversationSnapshot;
}): CodexThreadStreamCheckpoint {
  if (!Number.isSafeInteger(input.ownerEpoch) || input.ownerEpoch < 0) {
    throw new Error("Owner epoch must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new Error("Stream revision must be a non-negative safe integer");
  }
  return {
    protocolVersion: 1,
    ownerEpoch: input.ownerEpoch,
    revision: input.revision,
    canonicalHash: hashCodexConversationReplica(input.conversation),
  };
}

export function areCodexThreadStreamCheckpointsEqual(
  left: CodexThreadStreamCheckpoint | null | undefined,
  right: CodexThreadStreamCheckpoint | null | undefined,
): boolean {
  if (!left || !right) return left == null && right == null;
  return (
    left.protocolVersion === right.protocolVersion &&
    left.ownerEpoch === right.ownerEpoch &&
    left.revision === right.revision &&
    left.canonicalHash === right.canonicalHash
  );
}

export function isCodexThreadStreamCheckpoint(
  value: unknown,
): value is CodexThreadStreamCheckpoint {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CodexThreadStreamCheckpoint>;
  return (
    candidate.protocolVersion === 1 &&
    Number.isSafeInteger(candidate.ownerEpoch) &&
    (candidate.ownerEpoch ?? -1) >= 0 &&
    Number.isSafeInteger(candidate.revision) &&
    (candidate.revision ?? -1) >= 0 &&
    typeof candidate.canonicalHash === "string" &&
    /^[a-f0-9]{64}$/u.test(candidate.canonicalHash)
  );
}

export interface CodexThreadStreamReplica {
  checkpoint: CodexThreadStreamCheckpoint;
  conversation: CodexConversationSnapshot;
}

export type CodexThreadStreamReplicaApplyResult =
  | {
      accepted: true;
      replica: CodexThreadStreamReplica;
    }
  | Exclude<CodexThreadOwnerStreamStatePublishResult, { accepted: true }>;

function rejectedReplicaPublication(
  reason: Exclude<CodexThreadOwnerStreamStatePublishResult, { accepted: true }>["reason"],
  current: CodexThreadStreamReplica | null,
): CodexThreadStreamReplicaApplyResult {
  return {
    accepted: false,
    reason,
    recovery: current
      ? {
          checkpoint: current.checkpoint,
          conversationState: current.conversation,
        }
      : null,
  };
}

/**
 * Applies an owner publication as one compare-and-swap transaction.
 *
 * The caller owns authorization and epoch assignment. This function owns the
 * canonical revision/hash contract and never mutates the accepted replica on a
 * rejected publication.
 */
export function applyCodexThreadOwnerPublication(input: {
  current: CodexThreadStreamReplica | null;
  expectedOwnerEpoch: number;
  publication: CodexThreadOwnerStreamStatePublishInput;
}): CodexThreadStreamReplicaApplyResult {
  const { current, expectedOwnerEpoch, publication } = input;
  if (
    publication.checkpoint.ownerEpoch !== expectedOwnerEpoch ||
    (publication.baseCheckpoint !== null &&
      publication.baseCheckpoint.ownerEpoch !== expectedOwnerEpoch)
  ) {
    return rejectedReplicaPublication("owner-epoch-mismatch", current);
  }
  if (publication.checkpoint.protocolVersion !== 1) {
    return rejectedReplicaPublication("checkpoint-mismatch", current);
  }

  if (!current) {
    if (publication.baseCheckpoint !== null) {
      return rejectedReplicaPublication("missing-base", current);
    }
    if (publication.change.type !== "snapshot") {
      return rejectedReplicaPublication("missing-base", current);
    }
    if (publication.change.revision !== publication.checkpoint.revision) {
      return rejectedReplicaPublication("revision-gap", current);
    }
  } else {
    if (!publication.baseCheckpoint) {
      return rejectedReplicaPublication("missing-base", current);
    }
    if (!areCodexThreadStreamCheckpointsEqual(publication.baseCheckpoint, current.checkpoint)) {
      return rejectedReplicaPublication("base-checkpoint-mismatch", current);
    }
    if (publication.checkpoint.revision !== current.checkpoint.revision + 1) {
      return rejectedReplicaPublication("revision-gap", current);
    }
    if (publication.change.type === "patches") {
      if (
        publication.change.baseRevision !== current.checkpoint.revision ||
        publication.change.revision !== publication.checkpoint.revision
      ) {
        return rejectedReplicaPublication("revision-gap", current);
      }
    } else if (publication.change.revision !== publication.checkpoint.revision) {
      return rejectedReplicaPublication("revision-gap", current);
    }
  }

  let nextConversation: CodexConversationSnapshot;
  if (publication.change.type === "snapshot") {
    nextConversation = publication.change.conversationState;
  } else {
    if (!current) return rejectedReplicaPublication("missing-base", current);
    try {
      nextConversation = applyCodexConversationStateUpdates(
        current.conversation,
        publication.change.patches,
      );
    } catch {
      return rejectedReplicaPublication("patch-apply-failed", current);
    }
  }

  if (hashCodexConversationReplica(nextConversation) !== publication.checkpoint.canonicalHash) {
    return rejectedReplicaPublication("checkpoint-mismatch", current);
  }
  return {
    accepted: true,
    replica: {
      checkpoint: publication.checkpoint,
      conversation: nextConversation,
    },
  };
}
