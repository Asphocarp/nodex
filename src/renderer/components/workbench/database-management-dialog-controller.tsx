import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { DatabaseApplyOperationV2 } from "../../../shared/database-module-v2";
import {
  createCustomPropertyId,
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { createUuidV7 } from "../../../shared/uuid-v7";
import {
  commitDatabaseManagementOperations,
  DatabaseManagementMutationError,
  DatabaseManagementReadError,
  readDatabaseManagementAuthority,
  type DatabaseManagementAuthority,
} from "@/lib/database-management-runtime";
import { useProjectionRegistration } from "@/lib/projection-invalidation-context";
import {
  emptyDatabaseViewConfig,
  readDatabasePropertyOptions,
} from "@/lib/database-view-authoring";
import {
  readPropertyOptionRegistry,
  withPropertyOptions,
} from "@/lib/database-property-options-runtime";
import {
  DatabaseManagementDialog,
  type CreateDatabasePropertyDraft,
  type CreateDatabaseViewDraft,
  type PutDatabasePropertyOptionDraft,
  type UpdateDatabaseViewDraft,
} from "./database-management-dialog";

interface DatabaseManagementDialogControllerProps {
  readonly projectId: string;
  readonly initialDatabaseId?: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export const databaseManagementErrorMessage = (error: unknown): string => {
  if (
    error instanceof DatabaseManagementMutationError
    && error.commandError.code === "revision_conflict"
  ) {
    return "Database settings changed elsewhere. Review and try again.";
  }
  if (error instanceof DatabaseManagementReadError) {
    return "Couldn’t load database settings. Try again.";
  }
  return "Couldn’t save database settings. Try again.";
};

export function DatabaseManagementDialogController({
  projectId,
  initialDatabaseId = null,
  open,
  onOpenChange,
}: DatabaseManagementDialogControllerProps) {
  const [authority, setAuthority] =
    useState<DatabaseManagementAuthority | null>(null);
  const [selectedDatabaseId, setSelectedDatabaseId] =
    useState<string | null>(initialDatabaseId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readSequence = useRef(0);
  const authorityRef = useRef<DatabaseManagementAuthority | null>(null);
  const selectedDatabaseIdRef = useRef(selectedDatabaseId);
  selectedDatabaseIdRef.current = selectedDatabaseId;

  const hydratePropertyOptions = useCallback(async (
    next: DatabaseManagementAuthority,
  ): Promise<DatabaseManagementAuthority> => {
    const optionProperties = next.source.properties.filter((property) =>
      property.lifecycle === "active"
      && (property.valueType === "select" || property.valueType === "multi_select")
      && property.optionCount !== undefined
      && readDatabasePropertyOptions(property).length < property.optionCount);
    if (optionProperties.length === 0) return next;
    const registries = new Map(await Promise.all(optionProperties.map(async (property) => [
      property.propertyId,
      await readPropertyOptionRegistry({ kind: "project", projectId }, property),
    ] as const)));
    return {
      ...next,
      source: {
        ...next.source,
        properties: next.source.properties.map((property) => {
          const options = registries.get(property.propertyId);
          return options ? withPropertyOptions(property, options) : property;
        }),
      },
    };
  }, [projectId]);

  const applyAuthority = useCallback((next: DatabaseManagementAuthority) => {
    const nextDatabaseId = next.selectedDatabase.database.databaseId;
    selectedDatabaseIdRef.current = nextDatabaseId;
    authorityRef.current = next;
    startTransition(() => {
      setAuthority(next);
      setSelectedDatabaseId(nextDatabaseId);
    });
  }, []);

  const refresh = useCallback(async (
    preferredDatabaseId?: string | null,
  ) => {
    const sequence = ++readSequence.current;
    try {
      const next = await readDatabaseManagementAuthority(
        projectId,
        preferredDatabaseId ?? selectedDatabaseIdRef.current,
      );
      if (sequence !== readSequence.current) return;
      applyAuthority(await hydratePropertyOptions(next));
      setError(null);
    } catch (nextError) {
      if (sequence !== readSequence.current) return;
      console.error("[database-management:read]", nextError);
      setError(databaseManagementErrorMessage(nextError));
    }
  }, [applyAuthority, hydratePropertyOptions, projectId]);

  useEffect(() => {
    if (!open) return;
    setSelectedDatabaseId(initialDatabaseId);
    selectedDatabaseIdRef.current = initialDatabaseId;
    void refresh(initialDatabaseId);
  }, [initialDatabaseId, open, projectId, refresh]);

  useProjectionRegistration(open && authority
    ? {
      scope: {
        kind: "project",
        libraryId: authority.snapshot.libraryId,
        projectId,
      },
      consumerKey: `database-management:${projectId}`,
      getDependencies: () => {
        const current = authorityRef.current;
        const databases = current?.databases ?? [];
        return {
          aggregate: true,
          databaseIds: databases.map((item) => item.database.databaseId),
          dataSourceIds: databases.flatMap((item) =>
            item.dataSources.map((source) => source.dataSourceId)),
          viewIds: databases.flatMap((item) =>
            item.views.map((view) => view.viewId)),
        };
      },
      getCursor: () => {
        const current = authorityRef.current?.snapshot;
        return current
          ? {
              storeEpoch: current.storeEpoch,
              commitSeq: current.commitSeq,
            }
          : null;
      },
      invalidate: () => refresh(),
    }
    : null);

  const selectDatabase = (databaseId: string): void => {
    selectedDatabaseIdRef.current = databaseId;
    setSelectedDatabaseId(databaseId);
    setBusy(true);
    void refresh(databaseId).finally(() => setBusy(false));
  };

  const mutate = async (
    buildOperations: (
      current: DatabaseManagementAuthority,
    ) => readonly DatabaseApplyOperationV2[],
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await commitDatabaseManagementOperations({
        projectId,
        preferredDatabaseId: selectedDatabaseIdRef.current,
        operationId: crypto.randomUUID(),
        buildOperations,
      });
      applyAuthority(await hydratePropertyOptions(next));
    } catch (nextError) {
      console.error("[database-management:mutation]", nextError);
      setError(databaseManagementErrorMessage(nextError));
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const createProperty = async (draft: CreateDatabasePropertyDraft) => {
    const propertyId = createCustomPropertyId();
    await mutate((current) => {
      if (current.selectedDataSource.dataSourceId !== draft.dataSourceId) {
        throw new Error("Selected Data Source changed before property creation");
      }
      return [{
        kind: "put_property",
        dataSourceId: parseDataSourceId(draft.dataSourceId),
        propertyId,
        expectedDataSourceRevision: current.selectedDataSource.schemaRevision,
        expectedPropertyRevision: 0,
        name: draft.name,
        schema: draft.valueType === "relation"
          ? {
              kind: "relation",
              targetDataSourceId: parseDataSourceId(
                draft.targetDataSourceId ?? draft.dataSourceId,
              ),
            }
          : { kind: draft.valueType },
      }];
    });
  };

  const deleteProperty = async (
    dataSourceId: string,
    propertyId: string,
  ) => {
    await mutate((current) => {
      const property = current.source.properties.find(
        (candidate) => candidate.propertyId === propertyId,
      );
      if (!property || property.dataSourceId !== dataSourceId) {
        throw new Error(`Property is unavailable: ${propertyId}`);
      }
      return [{
        kind: "delete_property",
        dataSourceId: parseDataSourceId(dataSourceId),
        propertyId: parseDataSourcePropertyId(propertyId),
        expectedDataSourceRevision: current.selectedDataSource.schemaRevision,
        expectedPropertyRevision: property.revision,
      }];
    });
  };

  const createView = async (draft: CreateDatabaseViewDraft) => {
    const viewId = parseDatabaseViewId(createUuidV7());
    await mutate((current) => {
      if (
        current.selectedDatabase.database.databaseId !== draft.databaseId
        || current.selectedDataSource.dataSourceId !== draft.dataSourceId
      ) {
        throw new Error("Selected Database changed before View creation");
      }
      return [{
        kind: "put_view",
        databaseId: parseDatabaseId(draft.databaseId),
        dataSourceId: parseDataSourceId(draft.dataSourceId),
        viewId,
        expectedRevision: 0,
        name: draft.name,
        viewKind: draft.kind,
        config: emptyDatabaseViewConfig(),
        isDefault: false,
      }];
    });
  };

  const updateView = async (draft: UpdateDatabaseViewDraft) => {
    await mutate((current) => {
      const view = current.selectedDatabase.views.find(
        (candidate) => candidate.viewId === draft.viewId,
      );
      if (!view || view.revision !== draft.expectedRevision) {
        throw new Error(`View changed before save: ${draft.viewId}`);
      }
      return [{
        kind: "put_view",
        databaseId: parseDatabaseId(draft.databaseId),
        dataSourceId: parseDataSourceId(draft.dataSourceId),
        viewId: parseDatabaseViewId(draft.viewId),
        expectedRevision: draft.expectedRevision,
        name: draft.name,
        viewKind: draft.kind,
        config: draft.config,
        isDefault: view.isDefault,
        ...(draft.beforeViewId === undefined
          ? {}
          : {
              beforeViewId: draft.beforeViewId === null
                ? null
                : parseDatabaseViewId(draft.beforeViewId),
            }),
      }];
    });
  };

  const deleteView = async (databaseId: string, viewId: string) => {
    await mutate((current) => {
      const view = current.selectedDatabase.views.find(
        (candidate) => candidate.viewId === viewId,
      );
      if (!view || view.databaseId !== databaseId) {
        throw new Error(`View is unavailable: ${viewId}`);
      }
      return [{
        kind: "delete_view",
        databaseId: parseDatabaseId(databaseId),
        viewId: parseDatabaseViewId(viewId),
        expectedRevision: view.revision,
      }];
    });
  };

  const putPropertyOption = async (
    draft: PutDatabasePropertyOptionDraft,
  ) => {
    await mutate((current) => {
      const property = current.source.properties.find(
        (candidate) => candidate.propertyId === draft.propertyId,
      );
      if (!property || property.dataSourceId !== draft.dataSourceId) {
        throw new Error(`Property is unavailable: ${draft.propertyId}`);
      }
      const options = readDatabasePropertyOptions(property);
      if (options.some((option) => option.id === draft.option.id)) {
        throw new Error(`Property option already exists: ${draft.option.id}`);
      }
      return [{
        kind: "put_option",
        dataSourceId: parseDataSourceId(draft.dataSourceId),
        propertyId: property.propertyId,
        optionId: parseDataSourceOptionId({
          propertyId: property.propertyId,
          value: draft.option.id,
        }),
        name: draft.option.name,
        ...(draft.option.color === undefined
          ? {}
          : { color: draft.option.color }),
        expectedPropertyRevision: property.revision,
      }];
    });
  };

  const deletePropertyOption = async (
    dataSourceId: string,
    propertyId: string,
    optionId: string,
  ) => {
    await mutate((current) => {
      const property = current.source.properties.find(
        (candidate) => candidate.propertyId === propertyId,
      );
      if (!property || property.dataSourceId !== dataSourceId) {
        throw new Error(`Property is unavailable: ${propertyId}`);
      }
      const options = readDatabasePropertyOptions(property);
      if (!options.some((option) => option.id === optionId)) {
        throw new Error(`Property option is unavailable: ${optionId}`);
      }
      return [{
        kind: "delete_option",
        dataSourceId: parseDataSourceId(dataSourceId),
        propertyId: parseDataSourcePropertyId(propertyId),
        optionId: parseDataSourceOptionId({
          propertyId,
          value: optionId,
        }),
        expectedPropertyRevision: property.revision,
      }];
    });
  };

  return (
    <DatabaseManagementDialog
      open={open}
      databases={authority?.databases ?? []}
      source={authority?.source ?? null}
      selectedDatabaseId={selectedDatabaseId}
      busy={busy || authority === null}
      error={error}
      onOpenChange={onOpenChange}
      onSelectDatabase={selectDatabase}
      onCreateProperty={createProperty}
      onDeleteProperty={deleteProperty}
      onCreateView={createView}
      onUpdateView={updateView}
      onDeleteView={deleteView}
      onPutPropertyOption={putPropertyOption}
      onDeletePropertyOption={deletePropertyOption}
    />
  );
}
