import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  CalendarDays,
  CheckSquare2,
  Columns3,
  Database,
  Hash,
  List,
  Plus,
  SlidersHorizontal,
  Tags,
  TextCursorInput,
  Trash2,
  UserRound,
} from "lucide-react";
import type {
  DatabasePropertyOption,
  DatabasePropertyValueType,
  DatabaseViewConfigV2,
  DatabaseViewKind,
} from "../../../shared/database-kernel";
import type {
  DatabaseContainerDescriptorV2,
  DataSourceDescriptorV2,
} from "../../../shared/database-module-v2";
import { createCustomOptionId } from "../../../shared/database-identities";
import { NodexButton, NodexIconButton } from "@/components/ui/button";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  databaseViewConfigsEqual,
  databaseViewMoveBeforeId,
  readDatabasePropertyOptions,
} from "@/lib/database-view-authoring";
import { cn } from "@/lib/utils";
import { DatabaseViewConfigEditor } from "./database-view-config-editor";

export interface CreateDatabasePropertyDraft {
  readonly dataSourceId: string;
  readonly name: string;
  readonly valueType: DatabasePropertyValueType;
}

export interface CreateDatabaseViewDraft {
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly name: string;
  readonly kind: DatabaseViewKind;
}

export interface UpdateDatabaseViewDraft extends CreateDatabaseViewDraft {
  readonly viewId: string;
  readonly expectedRevision: number;
  readonly config: DatabaseViewConfigV2;
  /** Undefined preserves placement; null appends. */
  readonly beforeViewId?: string | null;
}

export interface PutDatabasePropertyOptionDraft {
  readonly dataSourceId: string;
  readonly propertyId: string;
  readonly option: DatabasePropertyOption;
}

export interface DatabaseManagementSurfaceProps {
  readonly databases: readonly DatabaseContainerDescriptorV2[];
  readonly source: DataSourceDescriptorV2 | null;
  readonly selectedDatabaseId: string | null;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onSelectDatabase: (databaseId: string) => void;
  readonly onCreateProperty: (
    draft: CreateDatabasePropertyDraft,
  ) => void | Promise<void>;
  readonly onDeleteProperty: (
    dataSourceId: string,
    propertyId: string,
  ) => void | Promise<void>;
  readonly onCreateView: (draft: CreateDatabaseViewDraft) => void | Promise<void>;
  readonly onUpdateView: (draft: UpdateDatabaseViewDraft) => void | Promise<void>;
  readonly onDeleteView: (
    databaseId: string,
    viewId: string,
  ) => void | Promise<void>;
  readonly onPutPropertyOption: (
    draft: PutDatabasePropertyOptionDraft,
  ) => void | Promise<void>;
  readonly onDeletePropertyOption: (
    dataSourceId: string,
    propertyId: string,
    optionId: string,
  ) => void | Promise<void>;
}

interface DatabaseManagementDialogProps extends DatabaseManagementSurfaceProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const PROPERTY_TYPES: readonly {
  readonly value: DatabasePropertyValueType;
  readonly label: string;
}[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "person", label: "Person" },
];

const VIEW_KINDS: readonly {
  readonly value: DatabaseViewKind;
  readonly label: string;
}[] = [
  { value: "list", label: "List" },
  { value: "kanban", label: "Board" },
  { value: "calendar", label: "Calendar" },
  { value: "canvas", label: "Canvas" },
];

const propertyTypeIcon = (valueType: DatabasePropertyValueType) => {
  switch (valueType) {
    case "number":
      return Hash;
    case "checkbox":
      return CheckSquare2;
    case "select":
    case "multi_select":
      return Tags;
    case "date":
    case "datetime":
      return CalendarDays;
    case "person":
      return UserRound;
    case "text":
      return TextCursorInput;
  }
};

const viewKindIcon = (kind: DatabaseViewKind) => {
  switch (kind) {
    case "kanban":
      return Columns3;
    case "calendar":
      return CalendarDays;
    case "canvas":
      return Boxes;
    case "list":
      return List;
  }
};

const submitTrimmed = (
  event: FormEvent<HTMLFormElement>,
  value: string,
  submit: (value: string) => void,
): void => {
  event.preventDefault();
  const normalized = value.trim();
  if (normalized) submit(normalized);
};

function SectionHeader({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div className="mb-2 flex min-w-0 items-end gap-3">
      <h3 className="shrink-0 text-sm font-medium text-token-text-primary">
        {title}
      </h3>
      <p className="truncate pb-px text-xs text-token-description-foreground">
        {detail}
      </p>
    </div>
  );
}

export function DatabaseManagementSurface({
  databases,
  source,
  selectedDatabaseId,
  busy = false,
  error = null,
  onSelectDatabase,
  onCreateProperty,
  onDeleteProperty,
  onCreateView,
  onUpdateView,
  onDeleteView,
  onPutPropertyOption,
  onDeletePropertyOption,
}: DatabaseManagementSurfaceProps) {
  const descriptor = databases.find(
    (candidate) => candidate.database.databaseId === selectedDatabaseId,
  ) ?? databases[0] ?? null;
  const [propertyName, setPropertyName] = useState("");
  const [propertyType, setPropertyType] =
    useState<DatabasePropertyValueType>("text");
  const [viewName, setViewName] = useState("");
  const [viewKind, setViewKind] = useState<DatabaseViewKind>("list");
  const [viewDrafts, setViewDrafts] = useState<Readonly<Record<
    string,
    {
      readonly baseRevision: number;
      readonly name: string;
      readonly kind: DatabaseViewKind;
      readonly config: DatabaseViewConfigV2;
    }
  >>>({});
  const [expandedViewId, setExpandedViewId] = useState<string | null>(null);
  const [optionDrafts, setOptionDrafts] = useState<Readonly<Record<
    string,
    string
  >>>({});

  useEffect(() => {
    if (!descriptor) return;
    if (descriptor.database.databaseId === selectedDatabaseId) return;
    onSelectDatabase(descriptor.database.databaseId);
  }, [descriptor, onSelectDatabase, selectedDatabaseId]);

  const activeProperties = source?.properties.filter(
    (property) => property.lifecycle === "active",
  ) ?? [];
  const activeViews = descriptor?.views.filter(
    (view) =>
      view.lifecycle === "active"
      && view.dataSourceId === source?.dataSource.dataSourceId,
  ) ?? [];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] max-sm:grid-cols-1">
      <aside className="flex min-h-0 flex-col border-r-[0.5px] border-token-border bg-token-foreground/3 max-sm:hidden">
        <div className="px-3 pb-3 pt-4">
          <h2 className="flex items-center gap-2 text-base font-medium text-token-text-primary">
            <Database className="size-4 shrink-0 text-token-description-foreground" />
            Databases
          </h2>
          <p className="mt-1 truncate text-xs text-token-description-foreground">
            Project binding and granted resources
          </p>
        </div>
        <nav
          aria-label="Authorized Databases"
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          {databases.map((candidate) => {
            const selected = candidate.database.databaseId
              === descriptor?.database.databaseId;
            const activeSourceCount = candidate.dataSources.filter(
              (dataSource) => dataSource.lifecycle === "active",
            ).length;
            return (
              <button
                key={candidate.database.databaseId}
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() =>
                  onSelectDatabase(candidate.database.databaseId)}
                className={cn(
                  "mb-0.5 flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm outline-none",
                  "focus-visible:ring-2 focus-visible:ring-token-focus",
                  selected
                    ? "bg-token-foreground/8 text-token-text-primary"
                    : "text-token-text-secondary hover:bg-token-foreground/5 hover:text-token-text-primary",
                )}
              >
                <Database className="size-3.5 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">
                  {candidate.database.name}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-token-description-foreground">
                  {activeSourceCount} source
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="min-h-0 overflow-y-auto px-5 pb-6 pt-4 max-sm:px-3">
        {descriptor && source ? (
          <>
            <header className="mb-6 pr-9">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-lg font-medium text-token-text-primary">
                  {descriptor.database.name}
                </h2>
                <span className="shrink-0 rounded-md bg-token-foreground/6 px-1.5 py-0.5 text-[10px] text-token-description-foreground">
                  {source.dataSource.name}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-token-description-foreground">
                {activeProperties.length} properties · {activeViews.length} Views · single Source
              </p>
            </header>

            <section className="mb-7" aria-labelledby="database-properties-heading">
              <SectionHeader
                title="Properties"
                detail="Schema owned by this Data Source"
              />
              <h3 id="database-properties-heading" className="sr-only">
                Data Source properties
              </h3>
              <div className="divide-y-[0.5px] divide-token-border border-y-[0.5px] border-token-border">
                {activeProperties.map((property) => {
                  const Icon = propertyTypeIcon(property.valueType);
                  const options = readDatabasePropertyOptions(property);
                  return (
                    <div key={property.propertyId} className="group py-2.5">
                      <div className="flex min-h-7 items-center gap-2">
                        <Icon className="size-3.5 shrink-0 text-token-description-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm text-token-text-primary">
                          {property.name}
                        </span>
                        <span className="shrink-0 text-xs text-token-description-foreground">
                          {PROPERTY_TYPES.find(
                            (type) => type.value === property.valueType,
                          )?.label}
                        </span>
                        <NodexIconButton
                          icon={Trash2}
                          size="xs"
                          tone="danger"
                          ariaLabel={`Delete property ${property.name}`}
                          disabled={busy}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => void onDeleteProperty(
                            source.dataSource.dataSourceId,
                            property.propertyId,
                          )}
                        />
                      </div>
                      {property.valueType === "select"
                        || property.valueType === "multi_select" ? (
                        <div className="ml-5 mt-2 flex flex-wrap items-center gap-1.5">
                          {options.map((option) => (
                            <span
                              key={option.id}
                              className="group/option inline-flex h-6 items-center gap-1 rounded-md bg-token-foreground/6 pl-2 pr-1 text-xs text-token-text-secondary"
                            >
                              {option.name}
                              <button
                                type="button"
                                aria-label={`Delete option ${option.name}`}
                                disabled={busy}
                                onClick={() => void onDeletePropertyOption(
                                  source.dataSource.dataSourceId,
                                  property.propertyId,
                                  option.id,
                                )}
                                className="rounded p-0.5 text-token-description-foreground opacity-0 hover:text-token-error-foreground group-hover/option:opacity-100 focus-visible:opacity-100"
                              >
                                <Trash2 className="size-3 shrink-0" />
                              </button>
                            </span>
                          ))}
                          <form
                            onSubmit={(event) => submitTrimmed(
                              event,
                              optionDrafts[property.propertyId] ?? "",
                              (name) => {
                                void onPutPropertyOption({
                                  dataSourceId: source.dataSource.dataSourceId,
                                  propertyId: property.propertyId,
                                  option: { id: createCustomOptionId(), name },
                                });
                                setOptionDrafts((current) => ({
                                  ...current,
                                  [property.propertyId]: "",
                                }));
                              },
                            )}
                          >
                            <input
                              aria-label={`Add option to ${property.name}`}
                              value={optionDrafts[property.propertyId] ?? ""}
                              disabled={busy}
                              onInput={(event) => setOptionDrafts((current) => ({
                                ...current,
                                [property.propertyId]: event.currentTarget.value,
                              }))}
                              placeholder="Add option"
                              className="h-6 w-24 bg-transparent px-1 text-xs text-token-text-secondary outline-none placeholder:text-token-description-foreground focus:w-32"
                            />
                          </form>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <form
                  className="flex items-center gap-2 py-2.5"
                  onSubmit={(event) => submitTrimmed(
                    event,
                    propertyName,
                    (name) => {
                      void onCreateProperty({
                        dataSourceId: source.dataSource.dataSourceId,
                        name,
                        valueType: propertyType,
                      });
                      setPropertyName("");
                    },
                  )}
                >
                  <Plus className="size-3.5 shrink-0 text-token-description-foreground" />
                  <Input
                    aria-label="New property name"
                    value={propertyName}
                    disabled={busy}
                    onInput={(event) => setPropertyName(event.currentTarget.value)}
                    placeholder="New property"
                    className="h-8 min-w-0 flex-1 border-transparent bg-transparent text-sm focus:bg-token-input-background"
                  />
                  <select
                    aria-label="New property type"
                    value={propertyType}
                    disabled={busy}
                    onChange={(event) => setPropertyType(
                      event.target.value as DatabasePropertyValueType,
                    )}
                    className="h-8 rounded-md border border-transparent bg-transparent px-2 text-xs text-token-text-secondary outline-none hover:bg-token-foreground/5 focus:border-token-focus-border"
                  >
                    {PROPERTY_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                  <NodexButton
                    type="submit"
                    size="xs"
                    variant="secondary"
                    disabled={busy || !propertyName.trim()}
                  >
                    Add
                  </NodexButton>
                </form>
              </div>
            </section>

            <section aria-labelledby="database-views-heading">
              <SectionHeader
                title="Views"
                detail="Presentation over this Data Source"
              />
              <h3 id="database-views-heading" className="sr-only">
                Database Views
              </h3>
              <div className="divide-y-[0.5px] divide-token-border border-y-[0.5px] border-token-border">
                {activeViews.map((view, index) => {
                  const storedDraft = viewDrafts[view.viewId];
                  const storedMatchesAuthority = storedDraft
                    ? storedDraft.name.trim() === view.name
                      && storedDraft.kind === view.kind
                      && databaseViewConfigsEqual(storedDraft.config, view.config)
                    : false;
                  const draft = storedDraft && !storedMatchesAuthority
                    ? storedDraft
                    : {
                        baseRevision: view.revision,
                        name: view.name,
                        kind: view.kind,
                        config: view.config,
                      };
                  const stale = draft.baseRevision !== view.revision;
                  const Icon = viewKindIcon(draft.kind);
                  const changed = draft.name.trim() !== view.name
                    || draft.kind !== view.kind
                    || !databaseViewConfigsEqual(draft.config, view.config);
                  const expanded = expandedViewId === view.viewId;
                  const moveUpBeforeId = databaseViewMoveBeforeId(
                    activeViews,
                    view.viewId,
                    "up",
                  );
                  const moveDownBeforeId = databaseViewMoveBeforeId(
                    activeViews,
                    view.viewId,
                    "down",
                  );
                  const updateDraft = (
                    update: Partial<Pick<
                      typeof draft,
                      "name" | "kind" | "config"
                    >>,
                  ) => setViewDrafts((current) => ({
                    ...current,
                    [view.viewId]: { ...draft, ...update },
                  }));
                  const submitView = (
                    beforeViewId?: string | null,
                  ): void => {
                    void onUpdateView({
                      databaseId: descriptor.database.databaseId,
                      dataSourceId: source.dataSource.dataSourceId,
                      viewId: view.viewId,
                      expectedRevision: draft.baseRevision,
                      name: draft.name.trim(),
                      kind: draft.kind,
                      config: draft.config,
                      ...(beforeViewId === undefined ? {} : { beforeViewId }),
                    });
                  };
                  return (
                    <div key={view.viewId} className="group/view">
                      <div className="flex min-h-10 items-center gap-1.5 py-1.5">
                        <Icon className="size-3.5 shrink-0 text-token-description-foreground" />
                        <Input
                          aria-label={`View name ${view.name}`}
                          value={draft.name}
                          disabled={busy || stale}
                          onInput={(event) => updateDraft({
                            name: event.currentTarget.value,
                          })}
                          className="h-8 min-w-0 flex-1 border-transparent bg-transparent text-sm focus:bg-token-input-background"
                        />
                        <select
                          aria-label={`View kind ${view.name}`}
                          value={draft.kind}
                          disabled={busy || stale}
                          onChange={(event) => updateDraft({
                            kind: event.target.value as DatabaseViewKind,
                          })}
                          className="h-8 rounded-md border border-transparent bg-transparent px-2 text-xs text-token-text-secondary outline-none hover:bg-token-foreground/5 focus:border-token-focus-border"
                        >
                          {VIEW_KINDS.map((kind) => (
                            <option key={kind.value} value={kind.value}>
                              {kind.label}
                            </option>
                          ))}
                        </select>
                        <NodexIconButton
                          icon={SlidersHorizontal}
                          size="xs"
                          active={expanded}
                          ariaLabel={`${expanded ? "Hide" : "Edit"} View settings ${view.name}`}
                          disabled={busy}
                          onClick={() => setExpandedViewId(
                            expanded ? null : view.viewId,
                          )}
                        />
                        <NodexIconButton
                          icon={ArrowUp}
                          size="xs"
                          ariaLabel={`Move View ${view.name} up`}
                          disabled={
                            busy || stale || changed || index === 0
                            || moveUpBeforeId === undefined
                          }
                          onClick={() => submitView(moveUpBeforeId)}
                        />
                        <NodexIconButton
                          icon={ArrowDown}
                          size="xs"
                          ariaLabel={`Move View ${view.name} down`}
                          disabled={
                            busy || stale || changed
                            || index === activeViews.length - 1
                            || moveDownBeforeId === undefined
                          }
                          onClick={() => submitView(moveDownBeforeId)}
                        />
                        {stale ? (
                          <NodexButton
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`Reload View ${view.name}`}
                            title="This View changed in another window"
                            onClick={() => setViewDrafts((current) => {
                              const next = { ...current };
                              delete next[view.viewId];
                              return next;
                            })}
                          >
                            Reload
                          </NodexButton>
                        ) : (
                          <NodexButton
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={busy || !changed || !draft.name.trim()}
                            aria-label={`Save View ${view.name}`}
                            onClick={() => submitView()}
                          >
                            Save
                          </NodexButton>
                        )}
                        {view.isDefault ? (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-token-description-foreground">
                            Default
                          </span>
                        ) : (
                          <NodexIconButton
                            icon={Trash2}
                            size="xs"
                            tone="danger"
                            ariaLabel={`Delete View ${view.name}`}
                            disabled={busy}
                            className="opacity-0 group-hover/view:opacity-100 focus-visible:opacity-100"
                            onClick={() => void onDeleteView(
                              descriptor.database.databaseId,
                              view.viewId,
                            )}
                          />
                        )}
                      </div>
                      {expanded ? (
                        <div className="mb-2 bg-token-foreground/3 px-2">
                          <DatabaseViewConfigEditor
                            config={draft.config}
                            properties={activeProperties}
                            disabled={busy || stale}
                            onChange={(config) => updateDraft({ config })}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <form
                  className="flex items-center gap-2 py-2.5"
                  onSubmit={(event) => submitTrimmed(
                    event,
                    viewName,
                    (name) => {
                      void onCreateView({
                        databaseId: descriptor.database.databaseId,
                        dataSourceId: source.dataSource.dataSourceId,
                        name,
                        kind: viewKind,
                      });
                      setViewName("");
                    },
                  )}
                >
                  <Plus className="size-3.5 shrink-0 text-token-description-foreground" />
                  <Input
                    aria-label="New View name"
                    value={viewName}
                    disabled={busy}
                    onInput={(event) => setViewName(event.currentTarget.value)}
                    placeholder="New View"
                    className="h-8 min-w-0 flex-1 border-transparent bg-transparent text-sm focus:bg-token-input-background"
                  />
                  <select
                    aria-label="New View kind"
                    value={viewKind}
                    disabled={busy}
                    onChange={(event) => setViewKind(
                      event.target.value as DatabaseViewKind,
                    )}
                    className="h-8 rounded-md border border-transparent bg-transparent px-2 text-xs text-token-text-secondary outline-none hover:bg-token-foreground/5 focus:border-token-focus-border"
                  >
                    {VIEW_KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>{kind.label}</option>
                    ))}
                  </select>
                  <NodexButton
                    type="submit"
                    size="xs"
                    variant="secondary"
                    disabled={busy || !viewName.trim()}
                  >
                    Add
                  </NodexButton>
                </form>
              </div>
            </section>

            {error ? (
              <p role="alert" className="mt-5 text-sm text-token-error-foreground">
                {error}
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Database className="mb-2 size-5 shrink-0 text-token-description-foreground" />
            <p className="text-sm font-medium text-token-text-primary">
              Database unavailable
            </p>
            <p className="mt-1 max-w-xs text-xs text-token-description-foreground">
              This Project needs an active Database binding and Data Source.
            </p>
            {error ? (
              <p role="alert" className="mt-3 text-xs text-token-error-foreground">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

export function DatabaseManagementDialog({
  open,
  onOpenChange,
  ...surfaceProps
}: DatabaseManagementDialogProps) {
  return (
    <NodexDialog open={open} onOpenChange={onOpenChange}>
      <NodexDialogContent
        className="h-[min(680px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[min(900px,calc(100vw-2rem))] max-w-none sm:max-w-none"
        closeButtonAriaLabel="Close Database manager"
      >
        <NodexDialogTitle className="sr-only">Manage Databases</NodexDialogTitle>
        <NodexDialogDescription className="sr-only">
          Manage Data Source properties and durable Database Views.
        </NodexDialogDescription>
        <DatabaseManagementSurface {...surfaceProps} />
      </NodexDialogContent>
    </NodexDialog>
  );
}
