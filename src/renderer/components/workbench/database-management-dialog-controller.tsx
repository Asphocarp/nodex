import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  DatabaseJsonValue,
  DatabasePropertyOption,
  DatabasePropertyValueType,
} from "../../../shared/database-kernel";
import type { DatabaseApplyOperation } from "../../../shared/database-module";
import {
  commitDatabaseManagementOperations,
  readDatabaseManagementAuthority,
  type DatabaseManagementAuthority,
} from "@/lib/database-management-runtime";
import { subscribeDatabaseChanges } from "@/lib/api";
import {
  emptyDatabaseViewConfig,
  readDatabasePropertyOptions,
} from "@/lib/database-view-authoring";
import { useMutationAuditSessionId } from "@/lib/mutation-audit-session";
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

const propertyConfig = (
  valueType: DatabasePropertyValueType,
): Readonly<Record<string, DatabaseJsonValue>> =>
  valueType === "select" || valueType === "multi_select"
    ? { options: [] }
    : {};

const propertyKey = (propertyId: string): string =>
  `custom_${propertyId.replaceAll("-", "_")}`;

const messageForError = (error: unknown): string =>
  error instanceof Error ? error.message : "Database management failed";

const replacePropertyOptions = (
  property: DatabaseManagementAuthority["source"]["properties"][number],
  options: readonly DatabasePropertyOption[],
): Readonly<Record<string, DatabaseJsonValue>> => ({
  ...property.config,
  options: options.map((option): DatabaseJsonValue => ({
    id: option.id,
    name: option.name,
    ...(option.color === undefined ? {} : { color: option.color }),
  })),
});

export function DatabaseManagementDialogController({
  projectId,
  initialDatabaseId = null,
  open,
  onOpenChange,
}: DatabaseManagementDialogControllerProps) {
  const clientSessionId = useMutationAuditSessionId();
  const [authority, setAuthority] =
    useState<DatabaseManagementAuthority | null>(null);
  const [selectedDatabaseId, setSelectedDatabaseId] =
    useState<string | null>(initialDatabaseId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readSequence = useRef(0);
  const selectedDatabaseIdRef = useRef(selectedDatabaseId);
  selectedDatabaseIdRef.current = selectedDatabaseId;

  const applyAuthority = useCallback((next: DatabaseManagementAuthority) => {
    const nextDatabaseId = next.selectedDatabase.database.databaseId;
    selectedDatabaseIdRef.current = nextDatabaseId;
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
      applyAuthority(next);
      setError(null);
    } catch (nextError) {
      if (sequence !== readSequence.current) return;
      setError(messageForError(nextError));
    }
  }, [applyAuthority, projectId]);

  useEffect(() => {
    if (!open) return;
    setSelectedDatabaseId(initialDatabaseId);
    selectedDatabaseIdRef.current = initialDatabaseId;
    void refresh(initialDatabaseId);
    return subscribeDatabaseChanges(projectId, () => {
      void refresh();
    });
  }, [initialDatabaseId, open, projectId, refresh]);

  const selectDatabase = (databaseId: string): void => {
    selectedDatabaseIdRef.current = databaseId;
    setSelectedDatabaseId(databaseId);
    setBusy(true);
    void refresh(databaseId).finally(() => setBusy(false));
  };

  const mutate = async (
    buildOperations: (
      current: DatabaseManagementAuthority,
    ) => readonly DatabaseApplyOperation[],
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await commitDatabaseManagementOperations({
        projectId,
        preferredDatabaseId: selectedDatabaseIdRef.current,
        operationId: crypto.randomUUID(),
        clientSessionId,
        buildOperations,
      });
      applyAuthority(next);
    } catch (nextError) {
      setError(messageForError(nextError));
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const createProperty = async (draft: CreateDatabasePropertyDraft) => {
    const propertyId = crypto.randomUUID();
    await mutate((current) => {
      if (current.selectedDataSource.dataSourceId !== draft.dataSourceId) {
        throw new Error("Selected Data Source changed before property creation");
      }
      return [{
        kind: "put_property",
        dataSourceId: draft.dataSourceId,
        propertyId,
        expectedDataSourceRevision: current.selectedDataSource.schemaRevision,
        expectedPropertyRevision: 0,
        key: propertyKey(propertyId),
        name: draft.name,
        valueType: draft.valueType,
        config: propertyConfig(draft.valueType),
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
        dataSourceId,
        propertyId,
        expectedDataSourceRevision: current.selectedDataSource.schemaRevision,
        expectedPropertyRevision: property.revision,
      }];
    });
  };

  const createView = async (draft: CreateDatabaseViewDraft) => {
    const viewId = crypto.randomUUID();
    await mutate((current) => {
      if (
        current.selectedDatabase.database.databaseId !== draft.databaseId
        || current.selectedDataSource.dataSourceId !== draft.dataSourceId
      ) {
        throw new Error("Selected Database changed before View creation");
      }
      return [{
        kind: "put_view",
        databaseId: draft.databaseId,
        dataSourceId: draft.dataSourceId,
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
        databaseId: draft.databaseId,
        dataSourceId: draft.dataSourceId,
        viewId: draft.viewId,
        expectedRevision: draft.expectedRevision,
        name: draft.name,
        viewKind: draft.kind,
        config: draft.config,
        isDefault: view.isDefault,
        ...(draft.beforeViewId === undefined
          ? {}
          : { beforeViewId: draft.beforeViewId }),
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
        databaseId,
        viewId,
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
        kind: "put_property",
        dataSourceId: draft.dataSourceId,
        propertyId: property.propertyId,
        expectedDataSourceRevision: current.selectedDataSource.schemaRevision,
        expectedPropertyRevision: property.revision,
        key: property.key,
        name: property.name,
        valueType: property.valueType,
        config: replacePropertyOptions(property, [...options, draft.option]),
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
        kind: "put_property",
        dataSourceId,
        propertyId,
        expectedDataSourceRevision: current.selectedDataSource.schemaRevision,
        expectedPropertyRevision: property.revision,
        key: property.key,
        name: property.name,
        valueType: property.valueType,
        config: replacePropertyOptions(
          property,
          options.filter((option) => option.id !== optionId),
        ),
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
