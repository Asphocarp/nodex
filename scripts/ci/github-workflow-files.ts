import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { load } from "js-yaml";

export type UnknownRecord = Readonly<Record<string, unknown>>;

export const repositoryRoot = path.resolve(import.meta.dirname, "../..");
export const workflowsDirectory = path.join(repositoryRoot, ".github/workflows");

export const relativeRepositoryPath = (filePath: string): string =>
  path.relative(repositoryRoot, filePath).split(path.sep).join("/");

export const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const requireRecord = (value: unknown, label: string): UnknownRecord => {
  if (isRecord(value)) return value;
  throw new Error(`${label} must be an object`);
};

export const workflowFiles = (): readonly string[] =>
  readdirSync(workflowsDirectory)
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
    .sort()
    .map((entry) => path.join(workflowsDirectory, entry));

export const readWorkflow = (filePath: string): UnknownRecord =>
  requireRecord(load(readFileSync(filePath, "utf8")), relativeRepositoryPath(filePath));
