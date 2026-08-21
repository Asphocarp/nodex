import {
  createCoreDocumentSyncAdapter,
  createCoreLibraryModuleAdapter,
  createCoreProjectWorkspaceAdapter,
  createDesktopDatabaseModuleBridge,
  type RustDataAuthorityRuntime,
} from "../../../src/main/core-client";
import { compilePageLifecycleRequestV2 } from "../../../src/shared/page-lifecycle-v2-runtime";
import type { Project, ProjectCreateInput } from "../../../src/shared/types";
import { createUuidV7 } from "../../../src/shared/uuid-v7";
import type {
  ScenarioBoardObservation,
  ScenarioDocumentReplacement,
  ScenarioPageObservation,
  ScenarioPageSeed,
  ScenarioSeedPort,
} from "../contracts";
import { normalizeScenarioBoardGroups } from "./normalize-board-groups";
import {
  ensurePrimaryDataSourcePropertyCount,
  readPrimaryDataSourcePropertyCount,
} from "../seed/primary-data-source-properties";

const requireSuccess = <Value>(
  result:
    | { readonly ok: true; readonly value: Value }
    | {
        readonly ok: false;
        readonly error: { readonly message: string };
      },
  label: string,
): Value => {
  if (result.ok) return result.value;
  throw new Error(`${label} failed: ${result.error.message}`);
};

export class CoreClientSeedAdapter implements ScenarioSeedPort {
  readonly #runtime: RustDataAuthorityRuntime;
  readonly #workspace;
  readonly #database;
  readonly #libraryIdsByProject = new Map<string, string>();
  #bootstrap: Promise<void> | null = null;

  constructor(runtime: RustDataAuthorityRuntime) {
    this.#runtime = runtime;
    this.#workspace = createCoreProjectWorkspaceAdapter(runtime.rootClient);
    this.#database = createDesktopDatabaseModuleBridge({
      authority: Promise.resolve(runtime),
    });
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    this.#bootstrap ??= this.#ensureInitialProject(input.sources?.[0]);
    await this.#bootstrap;
    const project = await this.#workspace.createProject(input);
    this.#libraryIdsByProject.set(project.id, project.libraryId);
    return project;
  }

  async createPage(input: ScenarioPageSeed): Promise<{ readonly documentId: string }> {
    const library = this.#library(input.projectId);
    const preflight = requireSuccess(
      await library.readPageLifecyclePreflight(input.projectId, input.pageId),
      `Preflight ${input.title}`,
    );
    const request = compilePageLifecycleRequestV2({
      intent: {
        kind: "create",
        operationId: input.operationId,
        projectId: input.projectId,
        pageId: input.pageId,
        status: input.status,
        input: { id: input.pageId, title: input.title, description: input.nfm },
      },
      preflight,
    });
    const receipt = requireSuccess(
      await library.applyPageLifecycleMutation(request),
      `Create ${input.title}`,
    );
    return { documentId: receipt.documentId };
  }

  async ensurePrimaryDataSourcePropertyCount(
    projectId: string,
    count: number,
  ): Promise<{ readonly commitSeq: number; readonly propertyCount: number }> {
    return await ensurePrimaryDataSourcePropertyCount(this.#database, projectId, count);
  }

  async readPrimaryDataSourcePropertyCount(projectId: string): Promise<number> {
    return await readPrimaryDataSourcePropertyCount(this.#database, projectId);
  }

  async replaceOwnedDocument(
    input: ScenarioDocumentReplacement,
  ): Promise<{ readonly commitSeq: number }> {
    const documents = createCoreDocumentSyncAdapter(
      this.#runtime.clientForProject(input.projectId),
    );
    const descriptor = requireSuccess(
      await documents.prepareOwner({
        ownerBlockId: input.pageId,
        operationId: input.operationId,
        clientSessionId: input.clientSessionId,
      }),
      `Prepare ${input.pageId}`,
    );
    const mutation = requireSuccess(
      await documents.applyDocumentMutation({
        mutationId: input.mutationId,
        projectId: input.projectId,
        storeEpoch: descriptor.storeEpoch,
        clientSessionId: input.clientSessionId,
        actor: { kind: "scenario_seed" },
        documentId: descriptor.documentId,
        generation: descriptor.generation,
        expectedHeadSeq: descriptor.headSeq,
        nfm: input.nfm,
      }),
      `Replace ${input.pageId}`,
    );
    return { commitSeq: mutation.commitSeq };
  }

  async readPage(
    projectId: string,
    pageId: string,
    minimumCommitSeq?: number,
  ): Promise<ScenarioPageObservation> {
    const detail = requireSuccess(
      await this.#library(projectId).readProjectPageDetail(projectId, pageId, minimumCommitSeq),
      `Read ${pageId}`,
    );
    return {
      pageId: detail.page.pageId,
      title: detail.page.title,
      descriptionPreview: detail.page.preview,
      documentReadiness: detail.document.readiness,
      commitSeq: detail.commitSeq,
    };
  }

  async readBoard(
    projectId: string,
    databaseViewId: string,
    minimumCommitSeq?: number,
  ): Promise<ScenarioBoardObservation> {
    const snapshot = await this.#database.getDatabaseViewGroups(projectId, {
      databaseViewId,
      ...(minimumCommitSeq === undefined ? {} : { minimumCommitSeq }),
    });
    const groups = normalizeScenarioBoardGroups(snapshot);
    return { totalRows: snapshot.totalRows, commitSeq: snapshot.commitSeq, groups };
  }

  #library(projectId: string) {
    const libraryId = this.#libraryIdsByProject.get(projectId);
    if (!libraryId) {
      throw new Error(`Scenario Project ${projectId} was not created by this adapter`);
    }
    return createCoreLibraryModuleAdapter({
      client: this.#runtime.clientForProject(projectId),
      libraryId,
      profileId: this.#runtime.identity.profileId,
      storeEpoch: this.#runtime.identity.storeEpoch,
    });
  }

  async #ensureInitialProject(sourceRoot?: string): Promise<void> {
    const bootstrap = await this.#workspace.readProjectBootstrap();
    if (bootstrap.status === "ready") return;
    const projectId = createUuidV7();
    await this.#workspace.createInitialProject({
      operationId: createUuidV7(),
      projectId,
      name: "Scenario Bootstrap",
      description: "",
      sources: sourceRoot ? [sourceRoot] : [],
      starterPage: {
        pageId: createUuidV7(),
        documentId: createUuidV7(),
        titleMarkdown: "Scenario Bootstrap",
        nfm: "Scenario bootstrap authority.",
      },
    });
  }
}
