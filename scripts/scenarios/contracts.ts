import type { Project, ProjectCreateInput } from "../../src/shared/types";
import type { WorkflowStatus } from "../../src/shared/workflow-status";

export const SCENARIO_MANIFEST_VERSION = 1 as const;

export interface ScenarioPageSeed {
  readonly key: string;
  readonly pageId: string;
  readonly operationId: string;
  readonly projectId: string;
  readonly status: WorkflowStatus;
  readonly title: string;
  readonly nfm: string;
}

export interface ScenarioDocumentReplacement {
  readonly mutationId: string;
  readonly operationId: string;
  readonly clientSessionId: string;
  readonly projectId: string;
  readonly pageId: string;
  readonly nfm: string;
}

export interface ScenarioPageObservation {
  readonly pageId: string;
  readonly title: string;
  readonly descriptionPreview: string;
  readonly documentReadiness: "pending_genesis" | "ready" | "failed";
  readonly commitSeq: number;
}

export interface ScenarioBoardObservation {
  readonly totalRows: number;
  readonly commitSeq: number;
  readonly groups: Readonly<Record<WorkflowStatus, number>>;
}

export interface ScenarioSeedPort {
  createProject(input: ProjectCreateInput): Promise<Project>;
  createPage(input: ScenarioPageSeed): Promise<{ readonly documentId: string }>;
  ensurePrimaryDataSourcePropertyCount(
    projectId: string,
    count: number,
  ): Promise<{ readonly commitSeq: number; readonly propertyCount: number }>;
  readPrimaryDataSourcePropertyCount(projectId: string): Promise<number>;
  replaceOwnedDocument(input: ScenarioDocumentReplacement): Promise<{ readonly commitSeq: number }>;
  readPage(
    projectId: string,
    pageId: string,
    minimumCommitSeq?: number,
  ): Promise<ScenarioPageObservation>;
  readBoard(
    projectId: string,
    databaseViewId: string,
    minimumCommitSeq?: number,
  ): Promise<ScenarioBoardObservation>;
}

export interface ScenarioManifest {
  readonly version: typeof SCENARIO_MANIFEST_VERSION;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly projectId: string;
  readonly databaseViewId: string;
  readonly pageIdsByKey: Readonly<Record<string, string>>;
  readonly minimumCommitSeq: number;
  readonly materializedAt: string;
}

export interface ScenarioFacts {
  readonly scenarioId: string;
  readonly scenarioRevision: number;
}

export interface ScenarioDomainRecipe {
  readonly id: string;
  readonly revision: number;
  materialize(port: ScenarioSeedPort, workspace: string): Promise<ScenarioManifest>;
  inspect(port: ScenarioSeedPort, manifest: ScenarioManifest): Promise<ScenarioFacts>;
  parseFacts(value: unknown): ScenarioFacts;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export const parseScenarioManifest = (value: unknown): ScenarioManifest => {
  if (!isRecord(value) || value.version !== SCENARIO_MANIFEST_VERSION) {
    throw new Error("Scenario manifest is invalid or unsupported");
  }
  if (
    !isNonEmptyString(value.scenarioId) ||
    typeof value.scenarioRevision !== "number" ||
    !isNonEmptyString(value.projectId) ||
    !isNonEmptyString(value.databaseViewId) ||
    typeof value.minimumCommitSeq !== "number" ||
    value.minimumCommitSeq < 0 ||
    !isNonEmptyString(value.materializedAt) ||
    !isRecord(value.pageIdsByKey) ||
    !Object.values(value.pageIdsByKey).every(isNonEmptyString)
  ) {
    throw new Error("Scenario manifest is invalid or unsupported");
  }
  return value as unknown as ScenarioManifest;
};

export const parseScenarioFacts = (value: unknown): ScenarioFacts => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.scenarioId) ||
    typeof value.scenarioRevision !== "number"
  ) {
    throw new Error("Scenario facts are invalid");
  }
  return value as unknown as ScenarioFacts;
};
