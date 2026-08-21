import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import {
  INITIAL_PROJECT_APPEARANCE,
  INITIAL_PROJECT_DESCRIPTION,
  INITIAL_PROJECT_FOLDER_BASENAME,
  INITIAL_PROJECT_NAME,
  type InitialProjectPresentation,
  renderInitialProjectWelcomePage,
} from "../shared/initial-project-welcome";
import type {
  DesktopInitialProjectCreateResult,
  DesktopProjectWorkspacePort,
} from "./core-client/project-workspace-adapter";
import {
  claimInitialProjectDirectory,
  ensureRealDirectory,
  initialProjectMarkerMatches,
  inspectInitialProjectDirectory,
  removeOwnedInitialProjectMarker,
  writeInitialProjectMarker,
} from "./initial-project/initial-project-filesystem";
import {
  type InitialProjectJournal,
  InitialProjectRecoveryJournal,
} from "./initial-project/initial-project-journal-store";
import { getLogger } from "./logging/logger";

const logger = getLogger({ subsystem: "initial-project-bootstrap" });

export interface InitialProjectBootstrapServiceOptions {
  readonly projectWorkspace: DesktopProjectWorkspacePort;
  readonly projectsDirectory: string;
  readonly journalPath: string;
  readonly createId?: () => string;
}

export interface EnsureInitialProjectInput {
  readonly onProvisioned: (presentation: InitialProjectPresentation) => Promise<void>;
}

export class InitialProjectBootstrapService {
  private readonly journal: InitialProjectRecoveryJournal;
  private readonly createId: () => string;
  private operationTail = Promise.resolve();

  constructor(private readonly options: InitialProjectBootstrapServiceOptions) {
    this.journal = new InitialProjectRecoveryJournal({
      filePath: options.journalPath,
    });
    this.createId = options.createId ?? randomUUID;
  }

  async ensureInitialProject(input: EnsureInitialProjectInput): Promise<void> {
    const result = this.operationTail
      .catch(() => undefined)
      .then(async () => await this.ensureInitialProjectWithinLock(input));
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    await result;
  }

  private async ensureInitialProjectWithinLock(input: EnsureInitialProjectInput): Promise<void> {
    const bootstrap = await this.options.projectWorkspace.readProjectBootstrap();
    let attempt = await this.journal.load();

    if (!attempt && bootstrap.status === "ready") return;
    if (attempt && bootstrap.status === "ready") {
      await this.finishReadyCatalogAttempt(attempt, input);
      return;
    }

    await ensureRealDirectory(this.options.projectsDirectory);
    if (!attempt) {
      attempt = this.createAttempt(
        join(this.options.projectsDirectory, INITIAL_PROJECT_FOLDER_BASENAME),
      );
      await this.journal.save(attempt);
    }
    const prepared = await this.prepareAttemptDirectory(attempt);
    await this.commitAttempt(prepared, input);
  }

  private async finishReadyCatalogAttempt(
    attempt: InitialProjectJournal,
    input: EnsureInitialProjectInput,
  ): Promise<void> {
    const ownProject = await this.options.projectWorkspace.getProject(attempt.payload.projectId);
    if (!ownProject) {
      await this.cleanupAttempt(attempt);
      logger.info("Accepted another client as the initial Project winner", {
        attemptId: attempt.attemptId,
      });
      return;
    }

    const created = await this.createInitialProject(attempt);
    await this.persistPresentation(attempt, created, input);
    await this.cleanupAttempt(attempt);
  }

  private createAttempt(sourceRoot: string): InitialProjectJournal {
    const page = renderInitialProjectWelcomePage({ sourceRoot });
    return {
      schemaVersion: 2,
      attemptId: this.createId(),
      operationId: this.createId(),
      payload: {
        projectId: this.createId(),
        name: INITIAL_PROJECT_NAME,
        description: INITIAL_PROJECT_DESCRIPTION,
        appearance: {
          color: INITIAL_PROJECT_APPEARANCE.color,
          marker: { ...INITIAL_PROJECT_APPEARANCE.marker },
        },
        sources: [sourceRoot],
        starterPage: {
          pageId: this.createId(),
          documentId: this.createId(),
          titleMarkdown: page.titleMarkdown,
          nfm: page.nfm,
        },
      },
    };
  }

  private retargetAttempt(
    attempt: InitialProjectJournal,
    sourceRoot: string,
  ): InitialProjectJournal {
    const page = renderInitialProjectWelcomePage({ sourceRoot });
    return {
      ...attempt,
      payload: {
        ...attempt.payload,
        sources: [sourceRoot],
        starterPage: {
          ...attempt.payload.starterPage,
          titleMarkdown: page.titleMarkdown,
          nfm: page.nfm,
        },
      },
    };
  }

  private async prepareAttemptDirectory(
    initialAttempt: InitialProjectJournal,
  ): Promise<InitialProjectJournal> {
    const initialRoot = initialAttempt.payload.sources[0];
    if (!initialRoot) {
      throw new Error("Initial Project recovery has no source root");
    }
    const initialState = await inspectInitialProjectDirectory(initialRoot);
    if (
      initialState === "real" &&
      (await initialProjectMarkerMatches(initialRoot, initialAttempt))
    ) {
      return initialAttempt;
    }
    if (initialState === "missing") {
      const created = await claimInitialProjectDirectory(initialRoot);
      if (created) {
        await writeInitialProjectMarker(initialRoot, initialAttempt);
        return initialAttempt;
      }
    }

    const parent = dirname(initialRoot);
    await ensureRealDirectory(parent);
    for (let suffix = 1; ; suffix += 1) {
      const directoryName =
        suffix === 1
          ? INITIAL_PROJECT_FOLDER_BASENAME
          : `${INITIAL_PROJECT_FOLDER_BASENAME} ${suffix}`;
      const sourceRoot = join(parent, directoryName);
      const attempt =
        sourceRoot === initialRoot
          ? initialAttempt
          : this.retargetAttempt(initialAttempt, sourceRoot);
      if (attempt !== initialAttempt) await this.journal.save(attempt);

      const state = await inspectInitialProjectDirectory(sourceRoot);
      if (state === "real" && (await initialProjectMarkerMatches(sourceRoot, attempt))) {
        return attempt;
      }
      if (state !== "missing") continue;
      if (!(await claimInitialProjectDirectory(sourceRoot))) continue;
      await writeInitialProjectMarker(sourceRoot, attempt);
      return attempt;
    }
  }

  private async commitAttempt(
    attempt: InitialProjectJournal,
    input: EnsureInitialProjectInput,
  ): Promise<void> {
    let created: DesktopInitialProjectCreateResult;
    try {
      created = await this.createInitialProject(attempt);
    } catch (error) {
      const ownProject = await this.options.projectWorkspace.getProject(attempt.payload.projectId);
      if (ownProject) {
        created = await this.createInitialProject(attempt);
      } else {
        const bootstrap = await this.options.projectWorkspace.readProjectBootstrap();
        if (bootstrap.status !== "ready") throw error;
        await this.cleanupAttempt(attempt);
        logger.info("Accepted another client as the initial Project winner", {
          attemptId: attempt.attemptId,
        });
        return;
      }
    }

    await this.persistPresentation(attempt, created, input);
    await this.cleanupAttempt(attempt);
    logger.info("Initial Project is ready", {
      projectId: created.project.id,
      sourceFolderName: basename(attempt.payload.sources[0] ?? ""),
    });
  }

  private async createInitialProject(
    attempt: InitialProjectJournal,
  ): Promise<DesktopInitialProjectCreateResult> {
    return await this.options.projectWorkspace.createInitialProject({
      operationId: attempt.operationId,
      projectId: attempt.payload.projectId,
      name: attempt.payload.name,
      description: attempt.payload.description,
      appearance: attempt.payload.appearance,
      sources: attempt.payload.sources,
      starterPage: attempt.payload.starterPage,
    });
  }

  private async persistPresentation(
    attempt: InitialProjectJournal,
    created: DesktopInitialProjectCreateResult,
    input: EnsureInitialProjectInput,
  ): Promise<void> {
    const defaultDatabaseViewId = created.project.defaultDatabaseViewId;
    if (!defaultDatabaseViewId) {
      throw new Error("Initial Project has no default Database View");
    }
    await input.onProvisioned({
      projectId: created.project.id,
      defaultDatabaseViewId,
      starterPageId: attempt.payload.starterPage.pageId,
      starterPageTitle: attempt.payload.starterPage.titleMarkdown,
    });
  }

  private async cleanupAttempt(attempt: InitialProjectJournal): Promise<void> {
    const sourceRoot = attempt.payload.sources[0];
    if (sourceRoot) {
      await removeOwnedInitialProjectMarker(sourceRoot, attempt);
    }
    await this.journal.clear();
  }
}
