import type { AutomationEvent } from "./automation-module";
import type { StoreEpoch } from "./common";
import type { OwnedDocumentEvent } from "./owned-document-module";
import type { ProjectWorkspaceEvent } from "./project-workspace-module";
import type { StoreAdministrationEvent } from "./store-administration-module";

export interface LibraryModuleEvent {
  readonly kind: "library_changed";
  readonly pageIds: readonly string[];
  readonly databaseIds: readonly string[];
  readonly parentKeys: readonly string[];
}

export interface DatabaseModuleEvent {
  readonly kind: "database_changed";
  readonly databaseIds: readonly string[];
  readonly dataSourceIds: readonly string[];
  readonly pageIds: readonly string[];
  readonly viewIds: readonly string[];
}

export type CoreModuleEventPayload =
  | { readonly module: "library"; readonly event: LibraryModuleEvent }
  | { readonly module: "database"; readonly event: DatabaseModuleEvent }
  | { readonly module: "owned_document"; readonly event: OwnedDocumentEvent }
  | {
      readonly module: "project_workspace";
      readonly event: ProjectWorkspaceEvent;
    }
  | { readonly module: "automation"; readonly event: AutomationEvent }
  | {
      readonly module: "store_administration";
      readonly event: StoreAdministrationEvent;
    };

export interface CommittedCoreModuleEvent {
  readonly version: 1;
  readonly sequence: number;
  readonly storeEpoch: StoreEpoch;
  readonly operationId: string | null;
  readonly committedAt: string;
  readonly payload: CoreModuleEventPayload;
}
