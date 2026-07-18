import {
  lstatSync,
  readFileSync,
  type Stats,
} from "node:fs";
import path from "node:path";

import { decodeBoundedJson } from "./codec";
import type { CoreRuntimeDescriptor } from "./types";

const RUNTIME_DIRECTORY_MODE = 0o700;
const PRIVATE_ENTRY_MODE = 0o600;
const MAX_DESCRIPTOR_BYTES = 16 * 1024;
const MAX_AUTH_BYTES = 128;
const AUTH_PATTERN = /^[a-f0-9]{64}$/;

export interface CoreRuntimeConnection {
  readonly descriptor: CoreRuntimeDescriptor;
  readonly authCapability: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (
  value: Readonly<Record<string, unknown>>,
  key: string,
): string => {
  const field = value[key];
  if (typeof field === "string" && field.length > 0) return field;
  throw new Error(`Core runtime descriptor has invalid ${key}`);
};

const requireInteger = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  minimum = 0,
): number => {
  const field = value[key];
  if (typeof field === "number" && Number.isSafeInteger(field) && field >= minimum) {
    return field;
  }
  throw new Error(`Core runtime descriptor has invalid ${key}`);
};

const assertOwned = (stats: Stats, label: string): void => {
  const currentUid = process.getuid?.();
  if (currentUid === undefined || stats.uid === currentUid) return;
  throw new Error(`${label} is not owned by the current user`);
};

const assertMode = (stats: Stats, expected: number, label: string): void => {
  const actual = stats.mode & 0o777;
  if (actual === expected) return;
  throw new Error(
    `${label} has mode ${actual.toString(8)}; expected ${expected.toString(8)}`,
  );
};

const inspectEntry = (
  entryPath: string,
  expectedMode: number,
  label: string,
): Stats => {
  const stats = lstatSync(entryPath);
  if (stats.isSymbolicLink()) throw new Error(`${label} must not be a symlink`);
  assertOwned(stats, label);
  assertMode(stats, expectedMode, label);
  return stats;
};

const parseDescriptor = (
  bytes: Uint8Array,
  expectedSocketPath: string,
): CoreRuntimeDescriptor => {
  const value = decodeBoundedJson<unknown>(
    bytes,
    MAX_DESCRIPTOR_BYTES,
    "Core runtime descriptor",
  );
  if (!isRecord(value)) throw new Error("Core runtime descriptor must be an object");

  const descriptor: CoreRuntimeDescriptor = {
    protocol_min: requireInteger(value, "protocol_min", 1),
    protocol_max: requireInteger(value, "protocol_max", 1),
    build_id: requireString(value, "build_id"),
    pid: requireInteger(value, "pid", 1),
    start_nonce: requireString(value, "start_nonce"),
    socket_path: requireString(value, "socket_path"),
    profile_id: requireString(value, "profile_id"),
    store_epoch: requireString(value, "store_epoch"),
    readiness_generation: requireInteger(value, "readiness_generation", 1),
  };
  if (descriptor.protocol_min > descriptor.protocol_max) {
    throw new Error("Core runtime descriptor has an inverted protocol range");
  }
  if (!path.isAbsolute(descriptor.socket_path)) {
    throw new Error("Core runtime descriptor socket_path must be absolute");
  }
  if (descriptor.socket_path !== expectedSocketPath) {
    throw new Error("Core runtime descriptor points outside the fixed runtime socket");
  }
  return descriptor;
};

export const readCoreRuntimeConnection = (
  nodexHome: string,
): CoreRuntimeConnection => {
  if (!path.isAbsolute(nodexHome)) throw new Error("Nodex home must be absolute");

  const runtimeDirectory = path.join(nodexHome, "run/core");
  const descriptorPath = path.join(runtimeDirectory, "core.json");
  const authPath = path.join(runtimeDirectory, "core.auth");
  const socketPath = path.join(runtimeDirectory, "core.sock");
  const runtimeStats = inspectEntry(
    runtimeDirectory,
    RUNTIME_DIRECTORY_MODE,
    "Core runtime directory",
  );
  if (!runtimeStats.isDirectory()) throw new Error("Core runtime path is not a directory");

  const descriptorStats = inspectEntry(
    descriptorPath,
    PRIVATE_ENTRY_MODE,
    "Core runtime descriptor",
  );
  if (!descriptorStats.isFile()) throw new Error("Core runtime descriptor is not a file");
  if (descriptorStats.size > MAX_DESCRIPTOR_BYTES) {
    throw new Error("Core runtime descriptor is oversized");
  }

  const authStats = inspectEntry(authPath, PRIVATE_ENTRY_MODE, "Core auth capability");
  if (!authStats.isFile()) throw new Error("Core auth capability is not a file");
  if (authStats.size > MAX_AUTH_BYTES) throw new Error("Core auth capability is oversized");

  const socketStats = inspectEntry(socketPath, PRIVATE_ENTRY_MODE, "Core socket");
  if (!socketStats.isSocket()) throw new Error("Core socket path is not a Unix socket");

  const descriptor = parseDescriptor(readFileSync(descriptorPath), socketPath);
  const authCapability = readFileSync(authPath, "utf8").trim();
  if (!AUTH_PATTERN.test(authCapability)) {
    throw new Error("Core auth capability has an invalid format");
  }
  return { descriptor, authCapability };
};
