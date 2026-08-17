import {
  type DatabaseApplyResultV2,
  type DatabaseApplyV2,
  type DatabaseModuleErrorV2,
  type DatabaseModuleReadRequestV2,
  type DatabaseModuleReadResultV2,
  type DatabasePageKeyNamespaceV2,
  type DatabasePageKeyPrefixPreviewV2,
  type LibraryDatabaseModuleReadRequestV2,
  type LibraryDatabaseModuleReadResultV2,
} from "../../shared/database-module-v2";
import { parseDatabaseId } from "../../shared/database-identities";
import {
  applyDatabaseModule,
  readDatabaseModule,
  readLibraryDatabaseModule,
} from "./api";

export interface DatabasePageKeyNamespaceAuthority {
  readonly namespace: DatabasePageKeyNamespaceV2;
  readonly storeEpoch: string;
}

export interface DatabasePageKeyRuntimeDependencies {
  readonly readProject: (
    projectId: string,
    request: DatabaseModuleReadRequestV2,
  ) => Promise<DatabaseModuleReadResultV2>;
  readonly readLibrary: (
    request: LibraryDatabaseModuleReadRequestV2,
  ) => Promise<LibraryDatabaseModuleReadResultV2>;
  readonly applyProject: (
    projectId: string,
    request: DatabaseApplyV2,
  ) => Promise<DatabaseApplyResultV2>;
}

export class DatabasePageKeyRuntimeError extends Error {
  constructor(readonly commandError: DatabaseModuleErrorV2) {
    super(commandError.message);
    this.name = "DatabasePageKeyRuntimeError";
  }

  get code(): string {
    return this.commandError.code;
  }

  get retryable(): boolean {
    return this.commandError.retryable;
  }
}

const defaultDependencies: DatabasePageKeyRuntimeDependencies = {
  readProject: async (projectId, request) =>
    await readDatabaseModule(projectId, request),
  readLibrary: async (request) => await readLibraryDatabaseModule(request),
  applyProject: async (projectId, request) =>
    await applyDatabaseModule(projectId, request),
};

const unwrapRead = <Snapshot extends {
  readonly value: { readonly kind: string };
}>(
  result:
    | { readonly ok: true; readonly value: Snapshot }
    | { readonly ok: false; readonly error: DatabaseModuleErrorV2 },
): Snapshot => {
  if (result.ok) return result.value;
  throw new DatabasePageKeyRuntimeError(result.error);
};

export async function previewDatabasePageKeyPrefix(
  input: {
    readonly projectId?: string;
    readonly databaseId?: string;
    readonly nameHint: string;
    readonly requestedPrefix?: string;
  },
  dependencies: DatabasePageKeyRuntimeDependencies = defaultDependencies,
): Promise<DatabasePageKeyPrefixPreviewV2> {
  const read = {
    target: {
      kind: "page_key_namespace" as const,
      ...(input.databaseId === undefined
        ? {}
        : { databaseId: parseDatabaseId(input.databaseId) }),
    },
    mode: "page_key_prefix_preview" as const,
    nameHint: input.nameHint,
    ...(input.requestedPrefix === undefined
      ? {}
      : { requestedPrefix: input.requestedPrefix }),
  };
  const snapshot = input.projectId === undefined
    ? unwrapRead(await dependencies.readLibrary({
        read,
      }))
    : unwrapRead(await dependencies.readProject(input.projectId, {
        projectId: input.projectId,
        read,
      }));
  if (snapshot.value.kind === "page_key_prefix_preview") {
    return snapshot.value.value;
  }
  throw new Error("Database Page-key preview returned an incompatible read value");
}

export async function readDatabasePageKeyNamespace(
  input: { readonly projectId: string; readonly databaseId: string },
  dependencies: DatabasePageKeyRuntimeDependencies = defaultDependencies,
): Promise<DatabasePageKeyNamespaceAuthority> {
  const snapshot = unwrapRead(await dependencies.readProject(input.projectId, {
    projectId: input.projectId,
    read: {
      target: {
        kind: "database",
        databaseId: parseDatabaseId(input.databaseId),
      },
      mode: "page_key_namespace",
    },
  }));
  if (snapshot.value.kind === "page_key_namespace") {
    return {
      namespace: snapshot.value.value,
      storeEpoch: snapshot.storeEpoch,
    };
  }
  throw new Error("Database Page-key namespace returned an incompatible read value");
}

export async function renameDatabasePageKeyPrefix(
  input: {
    readonly projectId: string;
    readonly databaseId: string;
    readonly storeEpoch: string;
    readonly expectedRevision: number;
    readonly prefix: string;
    readonly operationId?: string;
  },
  dependencies: DatabasePageKeyRuntimeDependencies = defaultDependencies,
): Promise<void> {
  const result = await dependencies.applyProject(input.projectId, {
    operationId: input.operationId ?? crypto.randomUUID(),
    projectId: input.projectId,
    storeEpoch: input.storeEpoch,
    actor: { kind: "renderer_project_settings" },
    operations: [{
      kind: "rename_page_key_prefix",
      databaseId: parseDatabaseId(input.databaseId),
      expectedRevision: input.expectedRevision,
      prefix: input.prefix,
    }],
  });
  if (!result.ok) throw new DatabasePageKeyRuntimeError(result.error);
}
