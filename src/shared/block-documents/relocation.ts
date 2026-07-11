import {
  MAX_BLOCK_ID_LENGTH,
  MAX_CARD_DOCUMENT_BLOCKS,
  MAX_CARD_DOCUMENT_STATE_BYTES,
  MAX_CARD_DOCUMENT_UPDATE_BYTES,
  MAX_RELOCATION_ID_LENGTH,
  MAX_RELOCATION_ROOT_BLOCKS,
  type BlockLocation,
  type RelocateBlocks,
  type RelocationDocumentCommit,
  type RelocationResult,
} from "./contracts";

const RELOCATION_CONTRACT_VERSION = 1;
const MAX_SCOPE_ID_LENGTH = 512;

export class RelocationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelocationContractError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new RelocationContractError(`${label} must be an object`);
};

const assertExactKeys = (
  record: Readonly<Record<string, unknown>>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const requiredKeys = new Set(required);
  const allowedKeys = new Set([...required, ...optional]);
  for (const key of requiredKeys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) continue;
    throw new RelocationContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(record)) {
    if (allowedKeys.has(key)) continue;
    throw new RelocationContractError(`${label}.${key} is not supported`);
  }
};

const readBoundedString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength = MAX_SCOPE_ID_LENGTH,
): string => {
  const value = record[key];
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim()
  ) {
    return value;
  }
  throw new RelocationContractError(
    `${label}.${key} must be a non-empty bounded string`,
  );
};

const readOptionalBoundedString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength = MAX_BLOCK_ID_LENGTH,
): string | undefined => {
  const value = record[key];
  if (value === undefined) return undefined;
  return readBoundedString(record, key, label, maximumLength);
};

const readInteger = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  minimum: number,
): number => {
  const value = record[key];
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
  ) {
    return value;
  }
  throw new RelocationContractError(
    `${label}.${key} must be a safe integer >= ${minimum}`,
  );
};

const readBoolean = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): boolean => {
  const value = record[key];
  if (typeof value === "boolean") return value;
  throw new RelocationContractError(`${label}.${key} must be a boolean`);
};

const readRootBlockIds = (
  record: Readonly<Record<string, unknown>>,
): readonly string[] => {
  const value = record.rootBlockIds;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_RELOCATION_ROOT_BLOCKS
  ) {
    throw new RelocationContractError(
      `relocation.rootBlockIds must contain 1-${MAX_RELOCATION_ROOT_BLOCKS} IDs`,
    );
  }
  const ids = value.map((entry) => {
    if (
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= MAX_BLOCK_ID_LENGTH &&
      entry === entry.trim()
    ) {
      return entry;
    }
    throw new RelocationContractError(
      "relocation.rootBlockIds contains an invalid ID",
    );
  });
  if (new Set(ids).size === ids.length) return ids;
  throw new RelocationContractError(
    "relocation.rootBlockIds contains a duplicate ID",
  );
};

const readExpectedLocationRevisions = (
  record: Readonly<Record<string, unknown>>,
  rootBlockIds: readonly string[],
): Readonly<Record<string, number>> => {
  const revisions = readRecord(
    record.expectedLocationRevisions,
    "relocation.expectedLocationRevisions",
  );
  const rootIds = new Set(rootBlockIds);
  const revisionKeys = Object.keys(revisions);
  if (
    revisionKeys.length !== rootBlockIds.length ||
    revisionKeys.some((key) => !rootIds.has(key))
  ) {
    throw new RelocationContractError(
      "relocation.expectedLocationRevisions must match rootBlockIds exactly",
    );
  }
  return Object.fromEntries(
    rootBlockIds.map((blockId) => {
      const revision = revisions[blockId];
      if (
        typeof revision !== "number" ||
        !Number.isSafeInteger(revision) ||
        revision < 1
      ) {
        throw new RelocationContractError(
          `relocation.expectedLocationRevisions.${blockId} must be a positive safe integer`,
        );
      }
      return [blockId, revision];
    }),
  );
};

const parseTarget = (
  value: unknown,
  sourceDocumentId: string,
  rootBlockIds: readonly string[],
): RelocateBlocks["target"] => {
  const target = readRecord(value, "relocation.target");
  if (target.kind === "document") {
    assertExactKeys(
      target,
      "relocation.target",
      ["kind", "documentId", "generation", "expectedHeadSeq"],
      ["parentBlockId", "beforeBlockId"],
    );
    const documentId = readBoundedString(
      target,
      "documentId",
      "relocation.target",
    );
    if (documentId === sourceDocumentId) {
      throw new RelocationContractError(
        "cross-Document relocation requires a different target Document",
      );
    }
    const parentBlockId = readOptionalBoundedString(
      target,
      "parentBlockId",
      "relocation.target",
    );
    const beforeBlockId = readOptionalBoundedString(
      target,
      "beforeBlockId",
      "relocation.target",
    );
    if (
      (parentBlockId !== undefined && rootBlockIds.includes(parentBlockId)) ||
      (beforeBlockId !== undefined && rootBlockIds.includes(beforeBlockId))
    ) {
      throw new RelocationContractError(
        "relocation target anchors cannot be among the moved roots",
      );
    }
    return {
      kind: "document",
      documentId,
      generation: readInteger(target, "generation", "relocation.target", 1),
      expectedHeadSeq: readInteger(
        target,
        "expectedHeadSeq",
        "relocation.target",
        0,
      ),
      ...(parentBlockId === undefined ? {} : { parentBlockId }),
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    };
  }

  if (target.kind === "space") {
    assertExactKeys(
      target,
      "relocation.target",
      ["kind", "projectId"],
      ["beforeBlockId"],
    );
    const beforeBlockId = readOptionalBoundedString(
      target,
      "beforeBlockId",
      "relocation.target",
    );
    if (beforeBlockId !== undefined && rootBlockIds.includes(beforeBlockId)) {
      throw new RelocationContractError(
        "relocation target anchor cannot be among the moved roots",
      );
    }
    return {
      kind: "space",
      projectId: readBoundedString(target, "projectId", "relocation.target"),
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    };
  }

  throw new RelocationContractError(
    "relocation.target.kind must be document or space",
  );
};

export const parseRelocateBlocks = (value: unknown): RelocateBlocks => {
  const relocation = readRecord(value, "relocation");
  assertExactKeys(relocation, "relocation", [
    "relocationId",
    "projectId",
    "storeEpoch",
    "rootBlockIds",
    "sourceDocumentId",
    "sourceGeneration",
    "expectedSourceHeadSeq",
    "expectedLocationRevisions",
    "target",
  ]);
  const rootBlockIds = readRootBlockIds(relocation);
  const sourceDocumentId = readBoundedString(
    relocation,
    "sourceDocumentId",
    "relocation",
  );
  return {
    relocationId: readBoundedString(
      relocation,
      "relocationId",
      "relocation",
      MAX_RELOCATION_ID_LENGTH,
    ),
    projectId: readBoundedString(relocation, "projectId", "relocation"),
    storeEpoch: readBoundedString(relocation, "storeEpoch", "relocation"),
    rootBlockIds,
    sourceDocumentId,
    sourceGeneration: readInteger(
      relocation,
      "sourceGeneration",
      "relocation",
      1,
    ),
    expectedSourceHeadSeq: readInteger(
      relocation,
      "expectedSourceHeadSeq",
      "relocation",
      0,
    ),
    expectedLocationRevisions: readExpectedLocationRevisions(
      relocation,
      rootBlockIds,
    ),
    target: parseTarget(relocation.target, sourceDocumentId, rootBlockIds),
  };
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

/**
 * Canonical request bytes are the sole input to the writer's synchronous
 * SHA-256. Keeping hashing out of this shared Module avoids coupling renderer
 * bundles to either Node crypto or asynchronous WebCrypto.
 */
export const canonicalizeRelocationRequest = (value: unknown): string => {
  const request = parseRelocateBlocks(value);
  return stableStringify({
    contractVersion: RELOCATION_CONTRACT_VERSION,
    ...request,
    rootBlockIds: [...request.rootBlockIds].sort(),
    expectedLocationRevisions: Object.fromEntries(
      Object.entries(request.expectedLocationRevisions).sort(
        ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
      ),
    ),
    target:
      request.target.kind === "document"
        ? {
            kind: request.target.kind,
            documentId: request.target.documentId,
            generation: request.target.generation,
            expectedHeadSeq: request.target.expectedHeadSeq,
            parentBlockId: request.target.parentBlockId ?? null,
            beforeBlockId: request.target.beforeBlockId ?? null,
          }
        : {
            kind: request.target.kind,
            projectId: request.target.projectId,
            beforeBlockId: request.target.beforeBlockId ?? null,
          },
  });
};

export const encodeRelocationRequestHashInput = (value: unknown): Uint8Array =>
  new TextEncoder().encode(canonicalizeRelocationRequest(value));

export const isRelocationRequestHash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

export const makeRelocationDocumentUpdateId = (
  requestHash: string,
  side: "source" | "target",
): string => {
  if (!isRelocationRequestHash(requestHash)) {
    throw new RelocationContractError(
      "relocation request hash must be lowercase SHA-256 hex",
    );
  }
  return `relocation:${requestHash}:${side}`;
};

const readBytes = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength: number,
): Uint8Array => {
  const value = record[key];
  if (
    value instanceof Uint8Array &&
    value.byteLength > 0 &&
    value.byteLength <= maximumLength
  ) {
    return value;
  }
  throw new RelocationContractError(
    `${label}.${key} must be a non-empty bounded Uint8Array`,
  );
};

const parseDocumentCommit = (
  value: unknown,
  label: string,
  allowCompactedUpdate: boolean,
): RelocationDocumentCommit => {
  const commit = readRecord(value, label);
  assertExactKeys(commit, label, [
    "documentId",
    "generation",
    "baseHeadSeq",
    "headSeq",
    "updateId",
    "update",
    "stateVector",
  ]);
  const baseHeadSeq = readInteger(commit, "baseHeadSeq", label, 0);
  const headSeq = readInteger(commit, "headSeq", label, 1);
  if (headSeq !== baseHeadSeq + 1) {
    throw new RelocationContractError(
      `${label}.headSeq must advance baseHeadSeq exactly once`,
    );
  }
  const update =
    commit.update === null && allowCompactedUpdate
      ? null
      : readBytes(commit, "update", label, MAX_CARD_DOCUMENT_UPDATE_BYTES);
  return {
    documentId: readBoundedString(commit, "documentId", label),
    generation: readInteger(commit, "generation", label, 1),
    baseHeadSeq,
    headSeq,
    updateId: readBoundedString(commit, "updateId", label),
    update,
    stateVector: readBytes(
      commit,
      "stateVector",
      label,
      MAX_CARD_DOCUMENT_STATE_BYTES,
    ),
  };
};

const readBlockIdList = (
  value: unknown,
  label: string,
  maximumLength: number,
): readonly string[] => {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > maximumLength
  ) {
    throw new RelocationContractError(`${label} has an invalid size`);
  }
  const blockIds = value.map((entry) => {
    if (
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= MAX_BLOCK_ID_LENGTH &&
      entry === entry.trim()
    ) {
      return entry;
    }
    throw new RelocationContractError(`${label} contains an invalid Block ID`);
  });
  if (new Set(blockIds).size === blockIds.length) return blockIds;
  throw new RelocationContractError(`${label} contains duplicate Block IDs`);
};

const parseBlockLocation = (value: unknown, label: string): BlockLocation => {
  const location = readRecord(value, label);
  if (location.kind === "document") {
    assertExactKeys(location, label, ["kind", "documentId"]);
    return {
      kind: "document",
      documentId: readBoundedString(location, "documentId", label),
    };
  }
  if (location.kind === "space") {
    assertExactKeys(location, label, ["kind", "projectId", "rankKey"]);
    return {
      kind: "space",
      projectId: readBoundedString(location, "projectId", label),
      rankKey: readBoundedString(location, "rankKey", label),
    };
  }
  throw new RelocationContractError(`${label}.kind is unsupported`);
};

const parseFinalLocations = (
  value: unknown,
): Readonly<Record<string, BlockLocation>> => {
  const locations = readRecord(value, "relocationResult.finalLocations");
  const entries = Object.entries(locations);
  if (entries.length < 1 || entries.length > MAX_CARD_DOCUMENT_BLOCKS) {
    throw new RelocationContractError(
      "relocationResult.finalLocations has an invalid size",
    );
  }
  return Object.fromEntries(
    entries.map(([blockId, location]) => {
      if (
        blockId.length < 1 ||
        blockId.length > MAX_BLOCK_ID_LENGTH ||
        blockId !== blockId.trim()
      ) {
        throw new RelocationContractError(
          "relocationResult.finalLocations contains an invalid Block ID",
        );
      }
      return [
        blockId,
        parseBlockLocation(
          location,
          `relocationResult.finalLocations.${blockId}`,
        ),
      ];
    }),
  );
};

const parseFinalLocationRevisions = (
  value: unknown,
  blockIds: readonly string[],
): Readonly<Record<string, number>> => {
  const revisions = readRecord(
    value,
    "relocationResult.finalLocationRevisions",
  );
  if (
    Object.keys(revisions).length !== blockIds.length ||
    blockIds.some((blockId) => !Object.hasOwn(revisions, blockId))
  ) {
    throw new RelocationContractError(
      "relocationResult final location maps must contain the same Blocks",
    );
  }
  return Object.fromEntries(
    blockIds.map((blockId) => {
      const revision = revisions[blockId];
      if (
        typeof revision !== "number" ||
        !Number.isSafeInteger(revision) ||
        revision < 2
      ) {
        throw new RelocationContractError(
          `relocationResult.finalLocationRevisions.${blockId} is invalid`,
        );
      }
      return [blockId, revision];
    }),
  );
};

export const parseRelocationResult = (
  value: unknown,
  expectedRequest?: RelocateBlocks,
): RelocationResult => {
  const result = readRecord(value, "relocationResult");
  assertExactKeys(
    result,
    "relocationResult",
    [
      "relocationId",
      "projectId",
      "storeEpoch",
      "duplicate",
      "rootBlockIds",
      "movedBlockIds",
      "finalLocations",
      "finalLocationRevisions",
      "sourceCommit",
      "changeLogSeq",
      "committedAt",
    ],
    ["targetCommit"],
  );
  const duplicate = readBoolean(result, "duplicate", "relocationResult");
  const rootBlockIds = readBlockIdList(
    result.rootBlockIds,
    "relocationResult.rootBlockIds",
    MAX_RELOCATION_ROOT_BLOCKS,
  );
  const movedBlockIds = readBlockIdList(
    result.movedBlockIds,
    "relocationResult.movedBlockIds",
    MAX_CARD_DOCUMENT_BLOCKS,
  );
  if (rootBlockIds.some((blockId) => !movedBlockIds.includes(blockId))) {
    throw new RelocationContractError(
      "relocationResult roots must be included among moved Blocks",
    );
  }
  const finalLocations = parseFinalLocations(result.finalLocations);
  if (
    movedBlockIds.length !== Object.keys(finalLocations).length ||
    movedBlockIds.some((blockId) => !Object.hasOwn(finalLocations, blockId))
  ) {
    throw new RelocationContractError(
      "relocationResult moved Blocks must match final location maps",
    );
  }
  const sourceCommit = parseDocumentCommit(
    result.sourceCommit,
    "relocationResult.sourceCommit",
    duplicate,
  );
  const targetCommit =
    result.targetCommit === undefined
      ? undefined
      : parseDocumentCommit(
          result.targetCommit,
          "relocationResult.targetCommit",
          duplicate,
        );
  const parsed: RelocationResult = {
    relocationId: readBoundedString(
      result,
      "relocationId",
      "relocationResult",
      MAX_RELOCATION_ID_LENGTH,
    ),
    projectId: readBoundedString(result, "projectId", "relocationResult"),
    storeEpoch: readBoundedString(result, "storeEpoch", "relocationResult"),
    duplicate,
    rootBlockIds,
    movedBlockIds,
    finalLocations,
    finalLocationRevisions: parseFinalLocationRevisions(
      result.finalLocationRevisions,
      Object.keys(finalLocations),
    ),
    sourceCommit,
    ...(targetCommit === undefined ? {} : { targetCommit }),
    changeLogSeq: readInteger(result, "changeLogSeq", "relocationResult", 1),
    committedAt: readBoundedString(result, "committedAt", "relocationResult"),
  };

  if (expectedRequest === undefined) return parsed;
  if (
    parsed.relocationId !== expectedRequest.relocationId ||
    parsed.projectId !== expectedRequest.projectId ||
    parsed.storeEpoch !== expectedRequest.storeEpoch ||
    parsed.sourceCommit.documentId !== expectedRequest.sourceDocumentId ||
    parsed.sourceCommit.generation !== expectedRequest.sourceGeneration ||
    parsed.sourceCommit.baseHeadSeq !== expectedRequest.expectedSourceHeadSeq
  ) {
    throw new RelocationContractError(
      "relocation result does not match its source request boundary",
    );
  }
  if (
    parsed.rootBlockIds.length !== expectedRequest.rootBlockIds.length ||
    parsed.rootBlockIds.some(
      (blockId) => !expectedRequest.rootBlockIds.includes(blockId),
    )
  ) {
    throw new RelocationContractError(
      "relocation result roots do not match the request",
    );
  }
  if (expectedRequest.target.kind === "space") {
    if (parsed.targetCommit === undefined) return parsed;
    throw new RelocationContractError(
      "space relocation results cannot contain a target Document commit",
    );
  }
  if (
    parsed.targetCommit?.documentId === expectedRequest.target.documentId &&
    parsed.targetCommit.generation === expectedRequest.target.generation &&
    parsed.targetCommit.baseHeadSeq === expectedRequest.target.expectedHeadSeq
  ) {
    return parsed;
  }
  throw new RelocationContractError(
    "relocation result does not match its target request boundary",
  );
};
