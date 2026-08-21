import type { DatabaseJsonValue, DatabasePropertyOption } from "../../../shared/database-kernel";
import type { DataSourcePropertyRecordV2 } from "../../../shared/database-module-v2";
import type {
  RelationCandidateWindow,
  RelationTargetWindow,
} from "@/lib/data-source-relation-value";

export type DataSourcePropertyOptionRegistryState = "idle" | "loading" | "ready" | "error";

/** Transport-agnostic capabilities consumed by every Property presenter. */
export interface DataSourcePropertyEditorBinding {
  readonly property: DataSourcePropertyRecordV2;
  readonly value: DatabaseJsonValue | undefined;
  readonly revision: number;
  readonly disabled: boolean;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly options?: readonly DatabasePropertyOption[];
  readonly optionRegistryState?: DataSourcePropertyOptionRegistryState;
  readonly optionRegistryHasMore?: boolean;
  readonly optionRegistryLoadingMore?: boolean;
  readonly onRequestOptions?: () => void;
  readonly onRequestMoreOptions?: () => void;
  readonly onChange: (value: DatabaseJsonValue) => void;
  readonly onCreateOption?: (option: {
    readonly optionId: string;
    readonly name: string;
    readonly color?: string;
  }) => void | Promise<unknown>;
  readonly onPatchOptions?: (delta: {
    readonly addOptionIds: readonly string[];
    readonly removeOptionIds: readonly string[];
  }) => void;
  readonly relationCandidates?: readonly {
    readonly pageId: string;
    readonly title: string;
  }[];
  readonly relationSourcePageId?: string;
  readonly onPatchRelation?: (delta: {
    readonly addPageIds: readonly string[];
    readonly removeEdgeIds: readonly string[];
  }) => void;
  readonly onReplaceOneRelation?: (targetPageId: string | null) => void;
  readonly onLoadRelationTargets?: (after: string | null) => Promise<RelationTargetWindow>;
  readonly onSearchRelationCandidates?: (
    query: string,
    after?: string | null,
  ) => Promise<RelationCandidateWindow>;
  readonly onLoadRelationTargetDescriptor?: () => Promise<{
    readonly name: string;
  } | null>;
  readonly onOpenRelationPage?: (pageId: string, title: string) => void;
  readonly onRelationValueStale?: () => void;
}
