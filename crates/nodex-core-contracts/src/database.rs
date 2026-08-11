use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::agent::AgentExecutionAuthorization;
use crate::collection::{CollectionWindow, CollectionWindowRequest};
use crate::events::ProjectionSnapshotAuthority;
use crate::{ModuleMutationReceipt, ModuleName, VersionedModuleContract};

pub const DATABASE_CONTRACT_VERSION: u32 = 10;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabasePropertySchema {
    Text,
    Number,
    Checkbox,
    Select,
    MultiSelect,
    Date,
    Datetime,
    Relation { target_data_source_id: String },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabasePropertySetMemberKind {
    Option,
    Page,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabasePropertyFilterOperator {
    Equals,
    NotEquals,
    Contains,
    NotContains,
    IsEmpty,
    IsNotEmpty,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabasePropertyCapabilities {
    pub replace: bool,
    pub patch_set_member: Option<DatabasePropertySetMemberKind>,
    pub filter_operators: Vec<DatabasePropertyFilterOperator>,
    pub sortable: bool,
    pub groupable: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabasePropertyDescriptor {
    pub property_id: String,
    pub data_source_id: String,
    pub name: String,
    pub schema: DatabasePropertySchema,
    pub capabilities: DatabasePropertyCapabilities,
    pub option_count: u32,
    pub rank_key: String,
    pub lifecycle: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseTarget {
    ProjectDefault,
    Database {
        database_id: String,
    },
    DataSource {
        data_source_id: String,
    },
    Property {
        data_source_id: String,
        property_id: String,
    },
    View {
        view_id: String,
    },
    PresentedView {
        view_id: String,
        presentation_override: DatabaseViewPresentationOverrideInput,
    },
    Page {
        page_id: String,
    },
    PageProperty {
        page_id: String,
        data_source_id: String,
        property_id: String,
    },
    AgentDataSource {
        data_source_id: String,
        query: Box<DatabaseAgentQuery>,
    },
    AgentView {
        view_id: String,
        query: Box<DatabaseAgentQuery>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseViewLayoutInput {
    Board,
    List,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseViewSortFieldInput {
    Manual,
    Title,
    Created,
    Property { property_id: String },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseViewSortDirectionInput {
    Asc,
    Desc,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseViewNullOrderInput {
    First,
    Last,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewSortInput {
    pub field: DatabaseViewSortFieldInput,
    pub direction: DatabaseViewSortDirectionInput,
    pub nulls: DatabaseViewNullOrderInput,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseViewGroupOverrideInput {
    None,
    Property { property_id: String },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseViewCompletedRangeInput {
    All,
    PastMonth,
    PastWeek,
    PastDay,
    None,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewCompletionOverrideInput {
    pub range: Option<DatabaseViewCompletedRangeInput>,
    pub order_by_recency: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewHierarchyOverrideInput {
    pub show_sub_pages: Option<bool>,
    pub nested_sub_pages: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseViewFieldInput {
    Property { property_id: String },
    Intrinsic { field: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewLayoutDisplayOverrideInput {
    pub fields: Option<Vec<DatabaseViewFieldInput>>,
    pub show_empty_groups: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewLayoutsOverrideInput {
    pub board: Option<DatabaseViewLayoutDisplayOverrideInput>,
    pub list: Option<DatabaseViewLayoutDisplayOverrideInput>,
}

/// A bounded Profile-local patch over a durable View presentation. Membership
/// filters and shared manual ranks are intentionally not overridable.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewPresentationOverrideInput {
    pub layout: Option<DatabaseViewLayoutInput>,
    pub sort: Option<Vec<DatabaseViewSortInput>>,
    pub group: Option<DatabaseViewGroupOverrideInput>,
    pub subgroup: Option<DatabaseViewGroupOverrideInput>,
    pub group_direction: Option<DatabaseViewSortDirectionInput>,
    pub completion: Option<DatabaseViewCompletionOverrideInput>,
    pub hierarchy: Option<DatabaseViewHierarchyOverrideInput>,
    pub layouts: Option<DatabaseViewLayoutsOverrideInput>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseReadMode {
    CatalogWindow,
    Database,
    DataSourceWindow,
    DataSource,
    PropertyWindow,
    OptionWindow,
    ViewDescriptorWindow,
    View,
    AgentQuery,
    ViewWindow,
    ListWindow,
    ViewGroups,
    ViewContext,
    RowsById,
    RowDetail,
    RelationTargetWindow,
    RelationCandidateWindow,
    ViewPersonalPreferences,
}

/// Restricts a `ViewWindow` read to one stable primary/secondary group path.
/// A null key addresses the unassigned value at that level.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseGroupScope {
    Path {
        group_key: Option<String>,
        subgroup_key: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct DatabaseRead {
    pub target: DatabaseTarget,
    pub mode: DatabaseReadMode,
    pub filter: Option<Value>,
    pub sort: Option<Vec<Value>>,
    pub window: Option<CollectionWindowRequest>,
    pub page_ids: Option<Vec<String>>,
    pub group_scope: Option<DatabaseGroupScope>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseAgentQuery {
    pub authorization: AgentExecutionAuthorization,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseReadValue {
    CatalogWindow {
        databases: CollectionWindow<Value>,
    },
    Database {
        value: Value,
    },
    DataSourceWindow {
        data_sources: CollectionWindow<Value>,
    },
    DataSource {
        value: Value,
    },
    PropertyWindow {
        properties: CollectionWindow<DatabasePropertyDescriptor>,
    },
    OptionWindow {
        options: CollectionWindow<Value>,
    },
    ViewDescriptorWindow {
        views: CollectionWindow<Value>,
    },
    View {
        value: Value,
    },
    AgentQuery {
        value: DatabaseViewWindow,
    },
    ViewWindow {
        value: DatabaseViewWindow,
    },
    ListWindow {
        value: DatabaseListWindow,
    },
    ViewGroups {
        value: DatabaseViewGroups,
    },
    ViewContext {
        value: Box<DatabaseViewContext>,
    },
    RowsById {
        value: DatabaseRowsById,
    },
    RowDetail {
        value: Box<DatabaseRowDetail>,
    },
    RelationTargetWindow {
        value: DatabaseRelationTargetWindow,
    },
    RelationCandidateWindow {
        candidates: CollectionWindow<DatabaseRelationCandidate>,
    },
    ViewPersonalPreferences {
        value: DatabaseViewPersonalPreferences,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewPersonalPreferences {
    pub presentation_override: DatabaseViewPresentationOverrideInput,
    pub collapsed_group_keys: Vec<String>,
    /// Zero means that this Profile has no durable preference row yet.
    pub revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseRelationCandidate {
    pub page_id: String,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseRelationTargetItem {
    Visible {
        edge_id: String,
        page_id: String,
        title: String,
        lifecycle: String,
        membership_state: String,
    },
    Restricted {
        edge_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseRelationTargetWindow {
    pub value_revision: i64,
    pub total_count: i64,
    pub targets: CollectionWindow<DatabaseRelationTargetItem>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseRelationValuePreview {
    pub value_revision: i64,
    pub total_count: i64,
    pub targets: Vec<DatabaseRelationTargetItem>,
    pub restricted_count: i64,
    pub has_more: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewWindow {
    pub database_id: String,
    pub data_source_id: String,
    pub view_id: String,
    pub projection: ProjectionSnapshotAuthority,
    pub rows: CollectionWindow<DatabaseRowSummary>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseListTransientKind {
    None,
    Ancestor,
    Child,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseListProjectionRow {
    Group {
        occurrence_key: String,
        group_key: Option<String>,
        total_occurrence_count: i64,
    },
    Subgroup {
        occurrence_key: String,
        group_key: Option<String>,
        subgroup_key: Option<String>,
        total_occurrence_count: i64,
    },
    Page {
        occurrence_key: String,
        summary: Box<DatabaseRowSummary>,
        group_path: Vec<Option<String>>,
        ancestor_page_ids: Vec<String>,
        depth: u32,
        has_children: bool,
        transient_kind: DatabaseListTransientKind,
        sibling_rank: Option<String>,
        hierarchy_revision: i64,
    },
}

impl DatabaseListProjectionRow {
    pub fn occurrence_key(&self) -> &str {
        match self {
            Self::Group { occurrence_key, .. }
            | Self::Subgroup { occurrence_key, .. }
            | Self::Page { occurrence_key, .. } => occurrence_key,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseListGroupSummary {
    pub group_key: Option<String>,
    pub subgroup_key: Option<String>,
    pub total_occurrence_count: i64,
}

/// A continuous window over the fully expanded List occurrence projection.
/// Model totals intentionally differ from occurrence totals when multi-value
/// grouping or transient hierarchy context repeats a Page.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseListWindow {
    pub database_id: String,
    pub data_source_id: String,
    pub view_id: String,
    pub projection: ProjectionSnapshotAuthority,
    pub rows: CollectionWindow<DatabaseListProjectionRow>,
    pub groups: Vec<DatabaseListGroupSummary>,
    pub total_projection_row_count: i64,
    pub total_occurrence_count: i64,
    pub total_model_count: i64,
    pub window_start: i64,
    pub window_end: i64,
    pub is_complete: bool,
}

/// Bounded per-group totals for a View, observed from data. At most
/// `MAX_VIEW_GROUP_SUMMARIES` groups are returned; `truncated` reports when the
/// grouping cardinality exceeded that bound. `grouped: false` means the View
/// has no grouping Property and only `total_rows` is meaningful.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewGroups {
    pub database_id: String,
    pub data_source_id: String,
    pub view_id: String,
    pub projection: ProjectionSnapshotAuthority,
    pub grouped: bool,
    pub subgrouped: bool,
    pub total_rows: i64,
    pub total_groups: i64,
    pub group_limit: usize,
    pub truncated: bool,
    pub groups: Vec<DatabaseViewGroupSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewGroupSummary {
    /// `None` counts the unassigned value at that path level.
    pub group_key: Option<String>,
    pub subgroup_key: Option<String>,
    pub total_rows: i64,
}

pub const MAX_VIEW_GROUP_SUMMARIES: usize = 200;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewContext {
    pub database: Value,
    pub data_source: Value,
    pub view: Value,
    pub properties: Vec<DatabasePropertyDescriptor>,
    pub groups: DatabaseViewGroups,
    pub projection: ProjectionSnapshotAuthority,
    pub rows: CollectionWindow<DatabaseViewContextRow>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewContextRow {
    pub summary: DatabaseRowSummary,
    pub move_etag: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseRowsById {
    pub rows: Vec<DatabaseRowSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseRowDetail {
    pub summary: DatabaseRowSummary,
    pub body_nfm: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseRowSummary {
    pub page_id: String,
    pub lifecycle: String,
    pub title: String,
    pub rich_title: Value,
    pub description_preview: String,
    pub description_length: i64,
    pub has_description: bool,
    pub database_values: BTreeMap<String, Value>,
    pub intrinsic_properties: BTreeMap<String, Value>,
    pub database_value_revisions: BTreeMap<String, i64>,
    pub metadata_revision: i64,
    pub parent_revision: i64,
    pub document_id: String,
    pub document_generation: i64,
    pub document_head_seq: i64,
    pub membership_id: String,
    pub membership_revision: i64,
    pub membership_created_at: String,
    pub created_at: String,
    pub updated_at: String,
    pub effective_group_key: Option<String>,
    pub effective_subgroup_key: Option<String>,
    pub rank_key: Option<String>,
    pub position_revision: Option<i64>,
    pub position_order: Option<i64>,
    pub task_parent_page_id: Option<String>,
    pub task_sibling_rank: Option<String>,
    pub task_hierarchy_revision: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseIntent {
    PutProperty {
        data_source_id: String,
        property_id: String,
        expected_data_source_revision: i64,
        expected_property_revision: i64,
        name: String,
        schema: DatabasePropertySchema,
        before_property_id: Option<String>,
    },
    DeleteProperty {
        data_source_id: String,
        property_id: String,
        expected_data_source_revision: i64,
        expected_property_revision: i64,
    },
    PutOption {
        data_source_id: String,
        property_id: String,
        option_id: String,
        name: String,
        color: Option<String>,
        expected_property_revision: i64,
    },
    DeleteOption {
        data_source_id: String,
        property_id: String,
        option_id: String,
        expected_property_revision: i64,
    },
    EditPropertyValues {
        edits: Vec<DatabasePropertyValueMutation>,
    },
    TransferPage {
        page_id: String,
        expected_parent_revision: i64,
        expected_active_membership_revision: i64,
        target: DatabaseTransferTarget,
    },
    PutView {
        database_id: String,
        data_source_id: String,
        view_id: String,
        expected_revision: i64,
        name: String,
        default_layout: String,
        config: Value,
        is_default: bool,
        before_view_id: Option<String>,
    },
    DeleteView {
        database_id: String,
        view_id: String,
        expected_revision: i64,
    },
    PositionPage {
        view_id: String,
        page_id: String,
        expected_position_revision: i64,
        before_page_id: Option<String>,
    },
    PositionPages {
        view_id: String,
        pages: Vec<DatabasePagePosition>,
        before_page_id: Option<String>,
    },
    SetTaskParent {
        data_source_id: String,
        pages: Vec<DatabaseTaskHierarchyPage>,
        parent_page_id: Option<String>,
        before_page_id: Option<String>,
    },
    PutViewPersonalPreferences {
        view_id: String,
        expected_revision: i64,
        presentation_override: DatabaseViewPresentationOverrideInput,
        collapsed_group_keys: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct DatabasePagePropertyAddress {
    pub page_id: String,
    pub data_source_id: String,
    pub property_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabasePropertyValueInput {
    Empty,
    Text { value: String },
    Number { value: f64 },
    Checkbox { value: bool },
    Select { option_id: String },
    MultiSelect { option_ids: Vec<String> },
    Date { value: String },
    Datetime { value: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabasePropertySetDelta {
    MultiSelect {
        add_option_ids: Vec<String>,
        remove_option_ids: Vec<String>,
    },
    Relation {
        add_page_ids: Vec<String>,
        remove_edge_ids: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabasePropertyValueEdit {
    Replace {
        expected_value_revision: i64,
        value: DatabasePropertyValueInput,
    },
    PatchSet {
        delta: DatabasePropertySetDelta,
    },
    ClearRelation {
        expected_value_revision: i64,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct DatabasePropertyValueMutation {
    pub address: DatabasePagePropertyAddress,
    pub edit: DatabasePropertyValueEdit,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabasePagePosition {
    pub page_id: String,
    pub expected_position_revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseTaskHierarchyPage {
    pub page_id: String,
    /// Zero means the Page is currently a task root with no hierarchy edge.
    pub expected_hierarchy_revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseTransferTarget {
    Library { library_id: String },
    Page { page_id: String },
    DataSource { data_source_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseReceipt {
    #[serde(flatten)]
    pub mutation: ModuleMutationReceipt,
    pub affected_database_ids: Vec<String>,
    pub affected_data_source_ids: Vec<String>,
    pub affected_page_ids: Vec<String>,
    pub affected_view_ids: Vec<String>,
    pub operation_kinds: Vec<String>,
    pub committed_revisions: BTreeMap<String, i64>,
    pub commit_seq: i64,
    pub committed_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseCommitValue {
    pub operation_count: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseEvent {
    pub kind: DatabaseEventKind,
    pub project_id: Option<String>,
    pub database_ids: Vec<String>,
    pub data_source_ids: Vec<String>,
    pub page_ids: Vec<String>,
    pub view_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseEventKind {
    DatabaseChanged,
}

pub struct DatabaseContract;

impl VersionedModuleContract for DatabaseContract {
    type Read = DatabaseRead;
    type Snapshot = DatabaseReadValue;
    type Intent = Vec<DatabaseIntent>;
    type Receipt = DatabaseReceipt;
    type Event = DatabaseEvent;

    const VERSION: u32 = DATABASE_CONTRACT_VERSION;
    const MODULE: ModuleName = ModuleName::Database;
}
