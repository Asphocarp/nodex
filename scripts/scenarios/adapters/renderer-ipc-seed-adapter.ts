import type { Page } from "playwright";

import type { CoreResult } from "../../../src/shared/core-result";
import type { IpcApi } from "../../../src/shared/ipc-api";
import { compilePageLifecycleRequestV2 } from "../../../src/shared/page-lifecycle-v2-runtime";
import type { Project, ProjectCreateInput } from "../../../src/shared/types";
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
  type ScenarioDatabasePort,
} from "../seed/primary-data-source-properties";

type IpcChannel = keyof IpcApi;

const unwrapCoreResult = <Value>(result: CoreResult<Value>, label: string): Value => {
  if (result.ok) return result.value;
  throw new Error(`${label} failed: ${result.error.message}`);
};

const requireSuccess = <Value>(
  result: { readonly ok: true; readonly value: Value } | {
    readonly ok: false;
    readonly error: { readonly message: string };
  },
  label: string,
): Value => {
  if (result.ok) return result.value;
  throw new Error(`${label} failed: ${result.error.message}`);
};

export class RendererIpcSeedAdapter implements ScenarioSeedPort {
  readonly #page: Page;

  constructor(page: Page) {
    this.#page = page;
  }

  async #invoke<Channel extends IpcChannel>(
    channel: Channel,
    ...args: IpcApi[Channel]["args"]
  ): Promise<IpcApi[Channel]["result"]> {
    return await this.#page.evaluate(
      async ({ targetChannel, targetArgs }) => {
        const api = (window as unknown as {
          api?: { invoke(channel: string, ...args: unknown[]): Promise<unknown> };
        }).api;
        if (!api) throw new Error("Nodex preload API is unavailable");
        return await api.invoke(targetChannel, ...(targetArgs as unknown[]));
      },
      { targetChannel: channel as string, targetArgs: args as unknown[] },
    ) as IpcApi[Channel]["result"];
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    return unwrapCoreResult(
      await this.#invoke("projects:create", input),
      "Project creation",
    );
  }

  async createPage(input: ScenarioPageSeed): Promise<{ readonly documentId: string }> {
    const preflight = requireSuccess(
      await this.#invoke("pages:lifecycle:preflight", input.projectId, input.pageId),
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
      await this.#invoke("pages:lifecycle:apply", input.projectId, request),
      `Create ${input.title}`,
    );
    return { documentId: receipt.documentId };
  }

  #databasePort(): ScenarioDatabasePort {
    return {
      read: async (request) => await this.#invoke(
        "database-module:read",
        request.projectId,
        request,
      ),
      apply: async (request) => await this.#invoke(
        "database-module:apply",
        request.projectId,
        request,
      ),
    };
  }

  async ensurePrimaryDataSourcePropertyCount(
    projectId: string,
    count: number,
  ): Promise<{ readonly commitSeq: number; readonly propertyCount: number }> {
    return await ensurePrimaryDataSourcePropertyCount(this.#databasePort(), projectId, count);
  }

  async readPrimaryDataSourcePropertyCount(projectId: string): Promise<number> {
    return await readPrimaryDataSourcePropertyCount(this.#databasePort(), projectId);
  }

  async replaceOwnedDocument(
    input: ScenarioDocumentReplacement,
  ): Promise<{ readonly commitSeq: number }> {
    const descriptor = requireSuccess(
      await this.#invoke("block-document:owned:prepare", input.projectId, input.pageId),
      `Prepare ${input.pageId}`,
    );
    const mutation = requireSuccess(await this.#invoke(
      "block-documents:mutate",
      input.projectId,
      descriptor.documentId,
      {
        mutationId: input.mutationId,
        projectId: input.projectId,
        storeEpoch: descriptor.storeEpoch,
        clientSessionId: input.clientSessionId,
        actor: { kind: "scenario_seed" },
        documentId: descriptor.documentId,
        generation: descriptor.generation,
        expectedHeadSeq: descriptor.headSeq,
        nfm: input.nfm,
      },
    ), `Replace ${input.pageId}`);
    return { commitSeq: mutation.commitSeq };
  }

  async readPage(
    projectId: string,
    pageId: string,
    minimumCommitSeq?: number,
  ): Promise<ScenarioPageObservation> {
    const detail = requireSuccess(
      await this.#invoke("pages:detail:get", projectId, pageId, minimumCommitSeq),
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
    const snapshot = unwrapCoreResult(
      await this.#invoke("database:view-groups:get", projectId, {
        databaseViewId,
        ...(minimumCommitSeq === undefined ? {} : { minimumCommitSeq }),
      }),
      "Read Board groups",
    );
    const groups = normalizeScenarioBoardGroups(snapshot);
    return { totalRows: snapshot.totalRows, commitSeq: snapshot.commitSeq, groups };
  }
}
