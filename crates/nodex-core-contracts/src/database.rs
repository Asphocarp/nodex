use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::agent::AgentExecutionAuthorization;
use crate::collection::{CollectionWindow, CollectionWindowRequest};
use crate::{ModuleMutationReceipt, ModuleName, VersionedModuleContract};

pub const DATABASE_CONTRACT_VERSION: u32 = 6;

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
    Person,
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
    ViewGroups,
    ViewContext,
    RowsById,
    RowDetail,
    RelationTargetWindow,
    RelationCandidateWindow,
}

/// Restricts a `ViewWindow` read to a single group of a grouped View, so each
/// board column can page independently. `Unassigned` addresses rows whose
/// grouping Property value is empty (NULL, empty string, or empty list).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseGroupScope {
    Key { key: String },
    Unassigned,
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
    ViewGroups {
        value: DatabaseViewGroups,
    },
    ViewContext {
        value: DatabaseViewContext,
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
        page_id: String,
        title: String,
        lifecycle: String,
        membership_state: String,
    },
    Restricted,
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
    pub rows: CollectionWindow<DatabaseRowSummary>,
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
    pub grouped: bool,
    pub total_rows: i64,
    pub truncated: bool,
    pub groups: Vec<DatabaseViewGroupSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewGroupSummary {
    /// `None` counts the unassigned group (empty grouping value).
    pub group_key: Option<String>,
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
    pub rank_key: Option<String>,
    pub position_revision: Option<i64>,
    pub position_order: Option<i64>,
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
        view_kind: String,
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
        group_key: Option<String>,
        before_page_id: Option<String>,
    },
    PositionPages {
        view_id: String,
        pages: Vec<DatabasePagePosition>,
        group_key: Option<String>,
        before_page_id: Option<String>,
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
    Person { person_id: String },
    Relation { page_ids: Vec<String> },
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
        remove_page_ids: Vec<String>,
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
    pub change_log_seq: i64,
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
