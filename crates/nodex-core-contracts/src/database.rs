use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::agent::AgentExecutionAuthorization;
use crate::collection::{CollectionWindow, CollectionWindowRequest};
use crate::events::ProjectionSnapshotAuthority;
use crate::{ModuleMutationReceipt, ModuleName, VersionedModuleContract};

pub const DATABASE_CONTRACT_VERSION: u32 = 17;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseRelationCardinality {
    One,
    Many,
}

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
    Relation {
        target_data_source_id: String,
        cardinality: DatabaseRelationCardinality,
    },
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
pub enum DatabaseViewLayout {
    Board,
    List,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseViewSortDirection {
    Asc,
    Desc,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseViewNullOrder {
    First,
    Last,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseViewFilterGroupOperator {
    And,
    Or,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseViewFilterOperator {
    Equals,
    NotEquals,
    Contains,
    NotContains,
    IsEmpty,
    IsNotEmpty,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DatabaseViewFilter {
    Group {
        operator: DatabaseViewFilterGroupOperator,
        #[schema(no_recursion)]
        children: Vec<DatabaseViewFilter>,
    },
    Clause {
        #[serde(rename = "propertyId")]
        property_id: String,
        operator: DatabaseViewFilterOperator,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<Value>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DatabaseViewSortField {
    Manual,
    Title,
    Created,
    Property {
        #[serde(rename = "propertyId")]
        property_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DatabaseViewSort {
    pub field: DatabaseViewSortField,
    pub direction: DatabaseViewSortDirection,
    pub nulls: DatabaseViewNullOrder,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseViewGroup {
    pub property_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseViewCompletedRange {
    All,
    PastMonth,
    PastWeek,
    PastDay,
    None,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseViewCompletion {
    pub range: DatabaseViewCompletedRange,
    pub order_by_recency: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseViewHierarchy {
    pub show_sub_pages: bool,
    pub nested_sub_pages: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseViewIntrinsicField {
    PageId,
    CreatedAt,
    UpdatedAt,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DatabaseViewField {
    Property {
        #[serde(rename = "propertyId")]
        property_id: String,
    },
    Intrinsic {
        field: DatabaseViewIntrinsicField,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseViewLayoutDisplay {
    pub fields: Vec<DatabaseViewField>,
    pub show_empty_groups: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DatabaseViewLayouts {
    pub board: DatabaseViewLayoutDisplay,
    pub list: DatabaseViewLayoutDisplay,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseViewPresentation {
    pub sort: Vec<DatabaseViewSort>,
    pub group: Option<DatabaseViewGroup>,
    pub subgroup: Option<DatabaseViewGroup>,
    pub group_direction: DatabaseViewSortDirection,
    pub completion: DatabaseViewCompletion,
    pub hierarchy: DatabaseViewHierarchy,
    pub layouts: DatabaseViewLayouts,
}

/// Durable View policy. Storage schema markers are an adapter concern and are
/// intentionally absent from the domain contract.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DatabaseViewDefinition {
    pub filter: DatabaseViewFilter,
    pub presentation: DatabaseViewPresentation,
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseAgentViewQuery {
    pub authorization: AgentExecutionAuthorization,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub projection_property_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DatabaseAgentDataSourceQuery {
    pub authorization: AgentExecutionAuthorization,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub projection_property_ids: Option<Vec<String>>,
    pub filter: DatabaseViewFilter,
    pub sort: Vec<DatabaseViewSort>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DatabaseIdentityTarget {
    ProjectDefault,
    Database { database_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DatabaseViewReadTarget {
    ProjectDefault,
    Database {
        database_id: String,
    },
    View {
        view_id: String,
    },
    PresentedView {
        view_id: String,
        presentation_override: DatabaseViewPresentationOverrideInput,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DatabaseRowsTarget {
    ProjectDefault,
    View { view_id: String },
}

/// One discriminated Database read command. Each variant carries only the
/// coordinates accepted by that read, so target/mode/optional-field
/// cross-products cannot cross the module boundary.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DatabaseRead {
    CatalogWindow {
        window: CollectionWindowRequest,
    },
    Database {
        target: DatabaseIdentityTarget,
    },
    DataSourceWindow {
        database_id: String,
        window: CollectionWindowRequest,
    },
    DataSource {
        data_source_id: String,
    },
    PropertyWindow {
        data_source_id: String,
        window: CollectionWindowRequest,
    },
    OptionWindow {
        data_source_id: String,
        property_id: String,
        window: CollectionWindowRequest,
    },
    ViewDescriptorWindow {
        database_id: String,
        window: CollectionWindowRequest,
    },
    View {
        view_id: String,
    },
    AgentDataSourceQuery {
        data_source_id: String,
        query: DatabaseAgentDataSourceQuery,
    },
    AgentViewQuery {
        view_id: String,
        query: DatabaseAgentViewQuery,
    },
    ViewWindow {
        target: DatabaseViewReadTarget,
        window: CollectionWindowRequest,
        group_scope: Option<DatabaseGroupScope>,
    },
    ListWindow {
        target: DatabaseViewReadTarget,
        window: CollectionWindowRequest,
    },
    ViewGroups {
        target: DatabaseViewReadTarget,
    },
    ViewContext {
        view_id: String,
        window: CollectionWindowRequest,
        group_scope: Option<DatabaseGroupScope>,
    },
    RowsById {
        target: DatabaseRowsTarget,
        page_ids: Vec<String>,
    },
    RowDetail {
        page_id: String,
    },
    RelationTargetWindow {
        address: DatabasePagePropertyAddress,
        window: CollectionWindowRequest,
    },
    RelationCandidateWindow {
        data_source_id: String,
        query: Option<String>,
        window: CollectionWindowRequest,
    },
    ViewPersonalPresentation {
        view_id: String,
    },
    ViewCollapsedOccurrences {
        view_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseContainerRecord {
    pub database_id: String,
    pub library_id: String,
    pub name: String,
    pub lifecycle: String,
    pub default_view_id: Option<String>,
    pub access_revision: i64,
    pub metadata_revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseDescriptor {
    pub database: DatabaseContainerRecord,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseDataSourceRecord {
    pub data_source_id: String,
    pub library_id: String,
    pub home_database_id: String,
    pub name: String,
    pub schema_key: String,
    pub schema_revision: i64,
    pub lifecycle: String,
    pub rank_key: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseDataSourceDescriptor {
    pub data_source: DatabaseDataSourceRecord,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewRecord {
    pub view_id: String,
    pub database_id: String,
    pub data_source_id: String,
    pub name: String,
    pub layout: DatabaseViewLayout,
    pub definition: DatabaseViewDefinition,
    pub is_default: bool,
    pub revision: i64,
    pub rank_key: String,
    pub lifecycle: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabasePropertyOption {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseReadValue {
    CatalogWindow {
        databases: CollectionWindow<DatabaseDescriptor>,
    },
    Database {
        value: DatabaseDescriptor,
    },
    DataSourceWindow {
        data_sources: CollectionWindow<DatabaseDataSourceRecord>,
    },
    DataSource {
        value: DatabaseDataSourceDescriptor,
    },
    PropertyWindow {
        properties: CollectionWindow<DatabasePropertyDescriptor>,
    },
    OptionWindow {
        options: CollectionWindow<DatabasePropertyOption>,
    },
    ViewDescriptorWindow {
        views: CollectionWindow<DatabaseViewRecord>,
    },
    View {
        value: DatabaseViewRecord,
    },
    AgentDataSourceQuery {
        value: DatabaseDataSourceQueryWindow,
    },
    AgentViewQuery {
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
    ViewPersonalPresentation {
        value: DatabaseViewPersonalPresentation,
    },
    ViewCollapsedOccurrences {
        value: DatabaseViewCollapsedOccurrences,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewPersonalPresentation {
    pub presentation_override: DatabaseViewPresentationOverrideInput,
    /// Zero means that this Profile has never changed this View presentation.
    pub revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DatabaseViewDisclosureTarget {
    Group { occurrence_key: String },
    Page { occurrence_key: String },
}

impl DatabaseViewDisclosureTarget {
    pub fn occurrence_key(&self) -> &str {
        match self {
            Self::Group { occurrence_key } | Self::Page { occurrence_key } => occurrence_key,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseViewCollapsedOccurrences {
    pub targets: Vec<DatabaseViewDisclosureTarget>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DatabasePersonalViewChange {
    Presentation {
        view_id: String,
        value: DatabaseViewPersonalPresentation,
    },
    OccurrenceDisclosure {
        view_id: String,
        target: DatabaseViewDisclosureTarget,
        collapsed: bool,
    },
}

impl DatabasePersonalViewChange {
    pub fn view_id(&self) -> &str {
        match self {
            Self::Presentation { view_id, .. } | Self::OccurrenceDisclosure { view_id, .. } => {
                view_id
            }
        }
    }
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseDataSourceQueryWindow {
    pub database_id: String,
    pub data_source_id: String,
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
        /// Number of Page occurrences in this visible occurrence subtree,
        /// including transient context rows and this row.
        subtree_occurrence_count: u32,
        /// Number of concrete Page occurrences in this subtree. Transient
        /// rows are skipped, but their descendants remain part of the count.
        concrete_subtree_page_count: u32,
        /// Maximum number of Parent edges below this occurrence.
        subtree_height: u32,
        /// Stable occurrence identity of the first direct child when one is
        /// present. This lets a bounded renderer preview the normalized
        /// "after parent" slot without materializing the whole subtree.
        first_child_occurrence_key: Option<String>,
        transient_kind: DatabaseListTransientKind,
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
    pub database: DatabaseContainerRecord,
    pub data_source: DatabaseDataSourceRecord,
    pub view: DatabaseViewRecord,
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
    /// Canonical Property values. Select-like values are stable option IDs.
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
    /// Revision of the standard `task_parent` Relation value. This remains
    /// populated for root tasks, which have no Relation edge.
    pub task_parent_value_revision: i64,
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
        layout: DatabaseViewLayout,
        definition: DatabaseViewDefinition,
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
        pages: Vec<DatabaseTaskParentPage>,
        parent_page_id: Option<String>,
        before_page_id: Option<String>,
    },
    MoveListOccurrences {
        view_id: String,
        presentation_override: DatabaseViewPresentationOverrideInput,
        expected_projection: DatabaseListProjectionExpectation,
        initiator_occurrence_key: String,
        selection: DatabaseListMoveSelection,
        target: DatabaseListMoveTarget,
    },
    UndoListOccurrenceMove {
        recipe: DatabaseListMoveUndoRecipe,
    },
    PutViewPersonalPresentation {
        view_id: String,
        expected_revision: i64,
        presentation_override: DatabaseViewPresentationOverrideInput,
    },
    SetViewOccurrenceDisclosure {
        view_id: String,
        target: DatabaseViewDisclosureTarget,
        collapsed: bool,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
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
    ReplaceOneRelation {
        expected_value_revision: i64,
        target_page_id: Option<String>,
    },
    ClearManyRelation {
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
pub struct DatabaseTaskParentPage {
    pub page_id: String,
    /// Root tasks retain an empty `task_parent` Relation value header, so this
    /// revision remains positive and monotonic.
    pub expected_value_revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseTransferTarget {
    Library { library_id: String },
    Page { page_id: String },
    DataSource { data_source_id: String },
}

/// Selection semantics for one Database List drag. Occurrence identities are
/// resolved against the exact effective List projection inside Core; callers
/// never materialize descendant Page IDs themselves.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseListMoveSelection {
    Explicit {
        occurrence_keys: Vec<String>,
    },
    AllMatching {
        excluded_occurrence_keys: Vec<String>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseListMoveEdge {
    Before,
    After,
    Inside,
}

/// A raw pointer target. Page target normalization (including
/// `after(parent) -> before(first child)`) remains a Core responsibility.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseListMoveTarget {
    Page {
        occurrence_key: String,
        edge: DatabaseListMoveEdge,
    },
    Group {
        occurrence_key: String,
    },
}

/// Renderer-visible causal coordinate. The canonical scope body is omitted
/// because callers only need to prove that the scope identity and revision
/// they rendered are still current.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseListProjectionExpectation {
    pub scope_key: String,
    pub schema_version: u32,
    pub revision: i64,
    pub covered_commit_seq: i64,
    pub effect_hash: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseListMoveNormalizedTarget {
    pub target_occurrence_key: String,
    pub target_page_id: Option<String>,
    pub parent_page_id: Option<String>,
    pub before_page_id: Option<String>,
    pub group_key: Option<String>,
    pub subgroup_key: Option<String>,
    pub depth: u32,
    pub edge: DatabaseListMoveEdge,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct DatabaseListMovePropertyState {
    pub page_id: String,
    pub property_id: String,
    pub before_value: DatabasePropertyValueInput,
    pub after_value: DatabasePropertyValueInput,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseListMoveParentGuard {
    pub page_id: String,
    pub parent_page_id: Option<String>,
}

/// One contiguous source run restored by semantic Undo. A null parent means
/// the Page run belonged at List root; `before_page_id` is always outside the
/// moved closure.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseListMoveRestoreRun {
    pub page_ids: Vec<String>,
    pub parent_page_id: Option<String>,
    pub before_page_id: Option<String>,
}

/// Opaque-to-UI inverse recipe. Core validates the move's logical post-image
/// before restoring these runs, so session Undo cannot overwrite a later edit.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct DatabaseListMoveUndoRecipe {
    pub view_id: String,
    pub data_source_id: String,
    pub property_states: Vec<DatabaseListMovePropertyState>,
    pub post_parent_guards: Vec<DatabaseListMoveParentGuard>,
    pub post_before_page_id: Option<String>,
    pub post_order_guard: bool,
    pub restore_runs: Vec<DatabaseListMoveRestoreRun>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseOperationOutcome {
    ListOccurrenceMove {
        operation_index: u32,
        moved_page_ids: Vec<String>,
        move_root_page_ids: Vec<String>,
        normalized_target: DatabaseListMoveNormalizedTarget,
        undo_recipe: Box<DatabaseListMoveUndoRecipe>,
    },
    ListOccurrenceMoveUndo {
        operation_index: u32,
        restored_page_ids: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct DatabaseReceipt {
    #[serde(flatten)]
    pub mutation: ModuleMutationReceipt,
    pub affected_database_ids: Vec<String>,
    pub affected_data_source_ids: Vec<String>,
    pub affected_page_ids: Vec<String>,
    pub affected_view_ids: Vec<String>,
    pub operation_kinds: Vec<String>,
    #[serde(default)]
    pub operation_outcomes: Vec<DatabaseOperationOutcome>,
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
    /// Profile-owned deltas are routed through View authorization but do not
    /// invalidate shared Database/View projections.
    #[serde(default)]
    pub personal_view_changes: Vec<DatabasePersonalViewChange>,
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
