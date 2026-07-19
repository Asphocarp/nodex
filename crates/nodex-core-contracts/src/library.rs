use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use serde_json::Value;

use crate::{ModuleMutationReceipt, ModuleName, VersionedModuleContract};

pub const LIBRARY_CONTRACT_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryRouteTarget {
    Page { page_id: String },
    Database { database_id: String },
    View { view_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryResourceTarget {
    Page { page_id: String },
    Database { database_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryNavigationParent {
    Library,
    Page { page_id: String },
    Database { database_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPlacementAnchor {
    pub block_id: String,
    pub expected_location_revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryWriteParent {
    Library {
        before: Option<LibraryPlacementAnchor>,
    },
    Page {
        page_id: String,
        expected_document_generation: i64,
        expected_document_head_seq: i64,
        before: Option<LibraryPlacementAnchor>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryRead {
    Metadata,
    Children {
        parent: LibraryNavigationParent,
        cursor: Option<String>,
        limit: Option<u32>,
        force_include_target: Option<LibraryRouteTarget>,
    },
    Path {
        target: LibraryRouteTarget,
    },
    Catalog {
        query: Option<String>,
        kinds: Option<Vec<LibraryCatalogKind>>,
        lifecycle: Option<LibraryLifecycle>,
        cursor: Option<String>,
        limit: Option<u32>,
    },
    PageDetail {
        page_id: String,
    },
    PageContent {
        page_id: String,
    },
    Search {
        query: String,
        include_archived: bool,
        source_kinds: Option<Vec<LibrarySearchSourceKind>>,
        block_types: Option<Vec<String>>,
        cursor: Option<String>,
        limit: Option<u32>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryCatalogKind {
    Page,
    Database,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryLifecycle {
    Active,
    Archived,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryNavigationNode {
    Page {
        page_id: String,
        title: String,
        has_children: bool,
        parent_revision: i64,
        metadata_revision: i64,
        document_generation: i64,
        document_head_seq: i64,
        updated_at: String,
    },
    Database {
        database_id: String,
        title: String,
        default_view_id: String,
        has_multiple_views: bool,
        metadata_revision: i64,
        location_revision: i64,
        updated_at: String,
    },
    View {
        view_id: String,
        database_id: String,
        data_source_id: String,
        title: String,
        view_kind: String,
        is_default: bool,
        revision: i64,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryCatalogEntry {
    pub target: LibraryResourceTarget,
    pub title: String,
    pub kind: LibraryCatalogKind,
    pub lifecycle: LibraryLifecycle,
    pub location_label: String,
    pub updated_at: String,
    pub location_revision: i64,
    pub metadata_revision: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageDocumentDescriptor {
    pub readiness: String,
    pub schema_key: String,
    pub schema_version: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageIntrinsicProperty {
    pub key: String,
    pub value_type: String,
    pub value: Value,
    pub revision: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageMembership {
    pub membership_id: String,
    pub data_source_id: String,
    pub revision: i64,
    pub created_at: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryPageAccessContext {
    Library,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryPageDataSourceContext {
    Standalone,
    Member {
        membership: LibraryPageMembership,
        database: Value,
        data_source: Value,
        properties: Vec<Value>,
        values: std::collections::BTreeMap<String, Value>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageDetail {
    pub version: u32,
    pub library_id: String,
    pub store_epoch: String,
    pub change_log_seq: i64,
    pub page: Value,
    pub document: LibraryPageDocumentDescriptor,
    pub intrinsic_properties: Vec<LibraryPageIntrinsicProperty>,
    pub data_source_context: LibraryPageDataSourceContext,
    pub access_context: LibraryPageAccessContext,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageContent {
    pub version: u32,
    pub library_id: String,
    pub store_epoch: String,
    pub change_log_seq: i64,
    pub page_id: String,
    pub metadata_revision: i64,
    pub document_id: String,
    pub document_generation: i64,
    pub document_head_seq: i64,
    pub schema_key: String,
    pub schema_version: i64,
    pub title: String,
    pub rich_title: Value,
    pub body_nfm: String,
    pub plain_text: String,
    pub preview: String,
    pub references: Vec<LibraryContentReference>,
    pub asset_refs: Vec<LibraryContentAssetReference>,
    pub access_context: LibraryPageAccessContext,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryContentReference {
    Block {
        #[serde(rename = "sourceBlockId")]
        source_block_id: String,
        #[serde(rename = "targetBlockId")]
        target_block_id: String,
        #[serde(rename = "displayHint", skip_serializing_if = "Option::is_none")]
        display_hint: Option<String>,
    },
    DatabaseView {
        #[serde(rename = "sourceBlockId")]
        source_block_id: String,
        #[serde(rename = "databaseViewId")]
        database_view_id: String,
        #[serde(rename = "displayHint", skip_serializing_if = "Option::is_none")]
        display_hint: Option<String>,
    },
    Thread {
        #[serde(rename = "sourceBlockId")]
        source_block_id: String,
        #[serde(rename = "targetThreadId")]
        target_thread_id: String,
    },
    LegacyCardProjection {
        #[serde(rename = "sourceBlockId")]
        source_block_id: String,
        #[serde(rename = "targetBlockId")]
        target_block_id: String,
        #[serde(rename = "projectHint", skip_serializing_if = "Option::is_none")]
        project_hint: Option<String>,
    },
    LegacyDatabaseQuery {
        #[serde(rename = "sourceBlockId")]
        source_block_id: String,
        #[serde(rename = "projectHint")]
        project_hint: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum LibraryContentAssetKind {
    Image,
    Attachment,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LibraryContentAssetReference {
    pub source_block_id: String,
    pub kind: LibraryContentAssetKind,
    pub source: String,
    pub managed_file_name: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibrarySearchSourceKind {
    DocumentTitle,
    DocumentBlock,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct LibrarySearchHit {
    pub project_id: String,
    pub owner_page_id: String,
    pub document_id: String,
    pub block_id: String,
    pub block_type: String,
    pub document_generation: i64,
    pub projected_seq: i64,
    pub source_kind: LibrarySearchSourceKind,
    pub field_key: String,
    pub excerpt: String,
    pub rank: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryReadValue {
    Metadata {
        profile_id: String,
        library_id: String,
        change_log_seq: i64,
    },
    Children {
        parent: LibraryNavigationParent,
        items: Vec<LibraryNavigationNode>,
        next_cursor: Option<String>,
        has_more: bool,
        total: u64,
    },
    Path {
        target: LibraryRouteTarget,
        nodes: Vec<LibraryNavigationNode>,
    },
    Catalog {
        items: Vec<LibraryCatalogEntry>,
        next_cursor: Option<String>,
        has_more: bool,
        total: u64,
    },
    PageDetail {
        value: Box<LibraryPageDetail>,
    },
    PageContent {
        value: Box<LibraryPageContent>,
    },
    Search {
        items: Vec<LibrarySearchHit>,
        next_cursor: Option<String>,
        has_more: bool,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryIntent {
    CreatePage {
        page_id: String,
        document_id: String,
        title: String,
        parent: LibraryWriteParent,
    },
    CreateDatabase {
        database_id: String,
        data_source_id: String,
        view_id: String,
        name: String,
        parent: LibraryWriteParent,
    },
    MoveBlock {
        target: LibraryResourceTarget,
        expected_location_revision: i64,
        parent: LibraryWriteParent,
    },
    ArchiveResource {
        target: LibraryResourceTarget,
        expected_metadata_revision: i64,
    },
    RestoreResource {
        target: LibraryResourceTarget,
        expected_metadata_revision: i64,
    },
    GrantProjectAccess {
        project_id: String,
        target: LibraryResourceTarget,
        access: LibraryAccess,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryAccess {
    Read,
    ReadWrite,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryReceipt {
    #[serde(flatten)]
    pub mutation: ModuleMutationReceipt,
    pub operation_kind: String,
    pub did_mutate: bool,
    pub created_target: Option<LibraryResourceTarget>,
    pub affected_parent_keys: Vec<String>,
    pub affected_page_ids: Vec<String>,
    pub affected_database_ids: Vec<String>,
    pub affected_view_ids: Vec<String>,
    pub committed_revisions: std::collections::BTreeMap<String, i64>,
    pub change_log_seq: i64,
    pub committed_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryCommitValue {
    pub affected_resource_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryEvent {
    pub kind: LibraryEventKind,
    pub page_ids: Vec<String>,
    pub database_ids: Vec<String>,
    pub parent_keys: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryEventKind {
    LibraryChanged,
}

pub struct LibraryContract;

impl VersionedModuleContract for LibraryContract {
    type Read = LibraryRead;
    type Snapshot = LibraryReadValue;
    type Intent = LibraryIntent;
    type Receipt = LibraryReceipt;
    type Event = LibraryEvent;

    const VERSION: u32 = LIBRARY_CONTRACT_VERSION;
    const MODULE: ModuleName = ModuleName::Library;
}
