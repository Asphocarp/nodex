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
pub enum LibraryPageCopyDestination {
    Library {
        before: Option<LibraryPlacementAnchor>,
    },
    Page {
        page_id: String,
        expected_document_generation: i64,
        expected_document_head_seq: i64,
        before: Option<LibraryPlacementAnchor>,
    },
    DataSource {
        data_source_id: String,
        expected_data_source_revision: i64,
        values: Vec<LibraryPageCopyValue>,
        view: Option<LibraryPageCopyViewPlacement>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageCopyValue {
    pub property_id: String,
    pub value: Value,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageCopyViewPlacement {
    pub view_id: String,
    pub expected_view_revision: i64,
    pub group_key: Option<String>,
    pub before: Option<LibraryPageCopyPositionAnchor>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageCopyPositionAnchor {
    pub page_id: String,
    pub expected_position_revision: i64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryBlockTransferMode {
    Move,
    Copy,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryBlockTransferSource {
    Library { library_id: String },
    Page { page_id: String },
    Document { document_id: String },
    DataSource { data_source_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryBlockTransferTarget {
    Library {
        library_id: String,
        before_block_id: Option<String>,
    },
    Page {
        page_id: String,
        parent_block_id: Option<String>,
        before_block_id: Option<String>,
    },
    Document {
        document_id: String,
        parent_block_id: Option<String>,
        before_block_id: Option<String>,
    },
    DataSource {
        data_source_id: String,
        view_id: String,
        group_key: Option<String>,
        before_page_id: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryBlockTransferLogicalIntent {
    pub actor: Value,
    pub mode: LibraryBlockTransferMode,
    pub root_block_ids: Vec<String>,
    pub source: LibraryBlockTransferSource,
    pub target: LibraryBlockTransferTarget,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryBlockTransferDocumentHead {
    pub document_id: String,
    pub generation: i64,
    pub expected_head_seq: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryBlockTransferMembership {
    pub membership_id: String,
    pub revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryBlockTransferWriteFence {
    pub documents: Vec<LibraryBlockTransferDocumentHead>,
    pub location_revisions: std::collections::BTreeMap<String, i64>,
    pub source_memberships: std::collections::BTreeMap<String, LibraryBlockTransferMembership>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryBlockTransferPreparation {
    pub write_fence: LibraryBlockTransferWriteFence,
    pub source_document_id: Option<String>,
    pub source_database_id: Option<String>,
    pub target_document_id: Option<String>,
    pub target_database_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryBlockLocation {
    Library {
        library_id: String,
        project_id: String,
        rank_key: String,
    },
    Document {
        document_id: String,
    },
    DataSource {
        database_id: String,
        data_source_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryBlockTransferDocumentCommit {
    pub document_id: String,
    pub generation: i64,
    pub base_head_seq: i64,
    pub head_seq: i64,
    pub update_id: String,
    pub update: Vec<u8>,
    pub state_vector: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryBlockTransferResult {
    pub mode: LibraryBlockTransferMode,
    pub source_root_block_ids: Vec<String>,
    pub result_root_block_ids: Vec<String>,
    pub copied_block_ids: std::collections::BTreeMap<String, String>,
    pub transformation_evidence: Vec<Value>,
    pub final_locations: std::collections::BTreeMap<String, LibraryBlockLocation>,
    pub final_location_revisions: std::collections::BTreeMap<String, i64>,
    pub document_commits: Vec<LibraryBlockTransferDocumentCommit>,
    pub affected_database_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryBlockTransferPlan {
    Prepared {
        preparation: LibraryBlockTransferPreparation,
    },
    Committed {
        result: LibraryBlockTransferResult,
        change_log_seq: i64,
        committed_at: String,
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
    PageTarget {
        page_id: String,
    },
    PageOwnershipPath {
        page_id: String,
    },
    PageLocation {
        page_id: String,
    },
    PageLifecyclePreflight {
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
    ProjectPageSearch {
        project_ids: Vec<String>,
        query: String,
        limit: Option<u32>,
    },
    PageHistory {
        page_id: String,
        before: Option<LibraryPageHistoryCursor>,
        limit: Option<u32>,
    },
    PlanBlockTransfer {
        operation_id: String,
        store_epoch: String,
        intent: LibraryBlockTransferLogicalIntent,
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageDocumentDescriptor {
    pub readiness: String,
    pub schema_key: String,
    pub schema_version: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LibraryPageTarget {
    Missing {
        target_page_id: String,
    },
    InvalidTarget {
        target_page_id: String,
        actual_block_type: String,
    },
    Deleted {
        target_page_id: String,
        library_id: String,
    },
    Available {
        target_page_id: String,
        page: Value,
        document: LibraryPageDocumentDescriptor,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageOwnershipPathAncestor {
    pub page_id: String,
    pub title: String,
    pub lifecycle: LibraryLifecycle,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LibraryPageOwnershipPath {
    Missing {
        target_page_id: String,
    },
    Available {
        target_page_id: String,
        ancestors: Vec<LibraryPageOwnershipPathAncestor>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLocation {
    pub page_id: String,
    pub project_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryPageLifecycleParent {
    Library { library_id: String },
    Page { page_id: String },
    DataSource { data_source_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecycleDocument {
    pub document_id: String,
    pub generation: i64,
    pub head_seq: i64,
    pub readiness: String,
    pub authority: String,
    pub schema_key: String,
    pub schema_version: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecyclePosition {
    pub group_key: Option<String>,
    pub rank_key: String,
    pub revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecycleMembership {
    pub membership_id: String,
    pub database_id: String,
    pub data_source_id: String,
    pub membership_revision: i64,
    pub view_id: String,
    pub view_revision: i64,
    pub status_property_id: String,
    pub status_value_revision: i64,
    pub status: LibraryPageWorkflowStatus,
    pub position: Option<LibraryPageLifecyclePosition>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecycleRestoreMembership {
    pub membership_id: String,
    pub database_id: String,
    pub data_source_id: String,
    pub status: LibraryPageWorkflowStatus,
    pub view_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecycleRestoreEvidence {
    pub delete_operation_id: String,
    pub previous_lifecycle: LibraryLifecycle,
    pub membership: Option<LibraryPageLifecycleRestoreMembership>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecycleAuthority {
    pub page_id: String,
    pub lifecycle: String,
    pub parent: LibraryPageLifecycleParent,
    pub library_rank_key: Option<String>,
    pub metadata_revision: i64,
    pub parent_revision: i64,
    pub document: LibraryPageLifecycleDocument,
    pub membership: Option<LibraryPageLifecycleMembership>,
    pub restore_evidence: Option<LibraryPageLifecycleRestoreEvidence>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecyclePreflight {
    pub version: u32,
    pub default_view: Value,
    pub tags_property: Value,
    pub reserved_block_type: Option<String>,
    pub page: Option<LibraryPageLifecycleAuthority>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecycleTagOption {
    pub option_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecycleRestorePosition {
    pub view_id: String,
    pub before_view_page_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecycleMutationMembership {
    pub membership_id: String,
    pub database_id: String,
    pub data_source_id: String,
    pub status: LibraryPageWorkflowStatus,
    pub position: Option<LibraryPageLifecycleRestorePosition>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
// This is an externally stable, internally tagged protocol union. The large
// create payload is boxed by `LibraryIntent::ApplyPageLifecycle`; splitting or
// boxing individual fields would complicate the wire contract without reducing
// the size of the request retained by the transport.
#[allow(clippy::large_enum_variant)]
pub enum LibraryPageLifecycleMutation {
    CreatePage {
        page_id: String,
        title: String,
        rich_title: Option<Value>,
        nfm: String,
        status: LibraryPageWorkflowStatus,
        priority: Option<String>,
        estimate: Option<String>,
        due_date: Option<String>,
        scheduled_start: Option<String>,
        scheduled_end: Option<String>,
        is_all_day: bool,
        recurrence: Option<Value>,
        reminders: Vec<Value>,
        schedule_timezone: Option<String>,
        assignee: Option<String>,
        run_in_target: String,
        run_in_local_path: Option<String>,
        run_in_base_branch: Option<String>,
        run_in_worktree_path: Option<String>,
        run_in_environment_path: Option<String>,
        before_block_id: Option<String>,
        before_view_page_id: Option<String>,
        data_source_id: String,
        tag_option_ids: Vec<String>,
        new_tag_options: Vec<LibraryPageLifecycleTagOption>,
        expected_tags_property_revision: i64,
    },
    ArchivePage {
        page_id: String,
        expected_metadata_revision: i64,
    },
    UnarchivePage {
        page_id: String,
        expected_metadata_revision: i64,
    },
    DeletePage {
        page_id: String,
        expected_metadata_revision: i64,
        expected_parent_revision: i64,
    },
    RestorePage {
        page_id: String,
        delete_operation_id: String,
        expected_metadata_revision: i64,
        expected_parent_revision: i64,
        membership: Option<LibraryPageLifecycleMutationMembership>,
        before_block_id: Option<String>,
    },
    MovePageInLibrary {
        page_id: String,
        expected_parent_revision: i64,
        before_block_id: Option<String>,
    },
}

impl LibraryPageLifecycleMutation {
    pub fn page_id(&self) -> &str {
        match self {
            Self::CreatePage { page_id, .. }
            | Self::ArchivePage { page_id, .. }
            | Self::UnarchivePage { page_id, .. }
            | Self::DeletePage { page_id, .. }
            | Self::RestorePage { page_id, .. }
            | Self::MovePageInLibrary { page_id, .. } => page_id,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryPageLifecycleState {
    Active,
    Archived,
    Deleted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecycleDeletedBlock {
    pub block_id: String,
    pub metadata_revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecycleDeleteEvidence {
    pub previous_lifecycle: LibraryLifecycle,
    pub membership: Option<LibraryPageLifecycleMutationMembership>,
    pub tombstoned_blocks: Vec<LibraryPageLifecycleDeletedBlock>,
    pub indexed_document_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageLifecycleMutationReceipt {
    pub operation_kind: String,
    pub page_id: String,
    pub metadata_revision: i64,
    pub parent_revision: i64,
    pub lifecycle: LibraryPageLifecycleState,
    pub document_id: String,
    pub document_generation: i64,
    pub document_head_seq: i64,
    pub database_id: Option<String>,
    pub data_source_id: Option<String>,
    pub membership_id: Option<String>,
    pub view_id: Option<String>,
    pub library_rank_key: Option<String>,
    pub view_rank_key: Option<String>,
    pub created_block_ids: Vec<String>,
    pub created_tag_option_ids: Vec<String>,
    pub delete_evidence: Option<LibraryPageLifecycleDeleteEvidence>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryBlockPropertyFieldMutation {
    IntrinsicSet {
        block_id: String,
        property_key: String,
        expected_revision: i64,
        value: Value,
    },
    DataSourceSet {
        page_id: String,
        data_source_id: String,
        property_id: String,
        expected_revision: i64,
        value: Option<String>,
    },
    DataSourceAddRemove {
        page_id: String,
        data_source_id: String,
        property_id: String,
        add: Vec<String>,
        remove: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryBlockPropertyMutation {
    pub actor: Value,
    pub client_session_id: Option<String>,
    pub fields: Vec<LibraryBlockPropertyFieldMutation>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryBlockPropertyMutationErrorCode {
    InvalidPropertyMutationRequest,
    MutationIdCollision,
    ProjectNotFound,
    BlockNotFound,
    BlockNotActive,
    BlockTypeMismatch,
    DataSourceNotFound,
    MembershipNotFound,
    PropertyNotFound,
    PropertyTypeMismatch,
    PropertyValueInvalid,
    PropertyValueCorrupt,
    PropertyConflict,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryBlockPropertyMutationError {
    pub code: LibraryBlockPropertyMutationErrorCode,
    pub message: String,
    pub retryable: bool,
    pub field_path: Option<String>,
    pub expected_revision: Option<i64>,
    pub actual_revision: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "scope", rename_all = "snake_case")]
pub enum LibraryBlockPropertyFieldResult {
    Intrinsic {
        path: String,
        block_id: String,
        property_key: String,
        operation: String,
        revision: i64,
        value: Value,
    },
    DataSource {
        path: String,
        block_id: String,
        data_source_id: String,
        property_id: String,
        operation: String,
        revision: i64,
        value: Value,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LibraryBlockPropertyMutationOutcome {
    Committed {
        fields: Vec<LibraryBlockPropertyFieldResult>,
        block_metadata_revisions: std::collections::BTreeMap<String, i64>,
    },
    Rejected {
        error: LibraryBlockPropertyMutationError,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryBlockPropertyMutationReceipt {
    pub outcome: LibraryBlockPropertyMutationOutcome,
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryPageWorkflowStatus {
    Triage,
    Plan,
    Build,
    Review,
    Ship,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryProjectPageSearchHit {
    pub project_id: String,
    pub page_id: String,
    pub status: LibraryPageWorkflowStatus,
    pub score: i64,
    pub excerpt: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum LibraryPageHistoryCursor {
    DocumentVersion {
        occurred_at: String,
        version_id: String,
    },
    ChangeLog {
        occurred_at: String,
        change_seq: i64,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryPageHistoryCategory {
    Checkpoint,
    Content,
    Property,
    Database,
    Lifecycle,
    Location,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageHistoryDisplay {
    pub category: LibraryPageHistoryCategory,
    pub title: String,
    pub detail: Option<String>,
    pub actor_label: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryPageHistoryEvidenceReason {
    MissingLedger,
    MalformedEvidence,
    UnsupportedEvidence,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LibraryPageHistoryEvidence {
    Verified,
    Unavailable {
        reason: LibraryPageHistoryEvidenceReason,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryPageHistoryRecoveryReason {
    DocumentGenerationChanged,
    InsufficientEvidence,
    NoInverseContract,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryPageHistoryRecovery {
    RestoreDocumentVersion {
        document_id: String,
        version_id: String,
    },
    Unavailable {
        reason: LibraryPageHistoryRecoveryReason,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageHistoryEntryBase {
    pub id: String,
    pub library_id: String,
    pub page_id: String,
    pub document_id: String,
    pub occurred_at: String,
    pub display: LibraryPageHistoryDisplay,
    pub evidence: LibraryPageHistoryEvidence,
    pub recovery: LibraryPageHistoryRecovery,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryDocumentRevisionKind {
    Automatic,
    Manual,
    Operation,
    Restore,
    Safety,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryDocumentVersionMetadata {
    pub version_id: String,
    pub generation: i64,
    pub base_head_seq: i64,
    pub schema_key: String,
    pub schema_version: i64,
    pub cause: String,
    pub label: Option<String>,
    pub revision_kind: LibraryDocumentRevisionKind,
    pub source_mutation_id: Option<String>,
    pub source_change_seq: Option<i64>,
    pub pinned: bool,
    pub checkpoint_hash: String,
    pub byte_length: i64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryBlockRelocationDirection {
    IntoPage,
    OutOfPage,
    WithinPage,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryPageHistoryEntry {
    DocumentVersion {
        #[serde(flatten)]
        entry: LibraryPageHistoryEntryBase,
        version_metadata: LibraryDocumentVersionMetadata,
    },
    BlockMutation {
        #[serde(flatten)]
        entry: LibraryPageHistoryEntryBase,
        change_seq: i64,
        mutation_id: Option<String>,
        mutation_kind: Option<String>,
        affected_block_count: Option<u32>,
        field_intent_count: Option<u32>,
    },
    BlockRelocation {
        #[serde(flatten)]
        entry: LibraryPageHistoryEntryBase,
        change_seq: i64,
        relocation_id: Option<String>,
        direction: LibraryBlockRelocationDirection,
        moved_block_count: Option<u32>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageHistoryPage {
    pub version: u32,
    pub library_id: String,
    pub page_id: String,
    pub document_id: String,
    pub entries: Vec<LibraryPageHistoryEntry>,
    pub next_cursor: Option<LibraryPageHistoryCursor>,
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
    PageTarget {
        value: Option<Box<LibraryPageTarget>>,
    },
    PageOwnershipPath {
        value: Option<Box<LibraryPageOwnershipPath>>,
    },
    PageLocation {
        value: Option<LibraryPageLocation>,
    },
    PageLifecyclePreflight {
        value: Box<LibraryPageLifecyclePreflight>,
    },
    Search {
        items: Vec<LibrarySearchHit>,
        next_cursor: Option<String>,
        has_more: bool,
    },
    ProjectPageSearch {
        items: Vec<LibraryProjectPageSearchHit>,
    },
    PageHistory {
        value: Box<LibraryPageHistoryPage>,
    },
    BlockTransferPlan {
        value: Box<LibraryBlockTransferPlan>,
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
    CopyPage {
        source_page_id: String,
        expected_location_revision: i64,
        expected_parent_revision: i64,
        expected_active_membership_revision: i64,
        expected_document_generation: i64,
        expected_document_head_seq: i64,
        destination: LibraryPageCopyDestination,
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
    ApplyPageLifecycle {
        mutation: Box<LibraryPageLifecycleMutation>,
    },
    ApplyBlockPropertyMutation {
        mutation: Box<LibraryBlockPropertyMutation>,
    },
    GrantProjectAccess {
        project_id: String,
        target: LibraryResourceTarget,
        access: LibraryAccess,
    },
    TransferBlocks {
        intent: LibraryBlockTransferLogicalIntent,
        write_fence: Option<LibraryBlockTransferWriteFence>,
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
    pub page_copy: Option<LibraryPageCopyResult>,
    pub block_transfer: Option<LibraryBlockTransferResult>,
    pub page_lifecycle: Option<LibraryPageLifecycleMutationReceipt>,
    pub block_property_mutation: Option<LibraryBlockPropertyMutationReceipt>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LibraryPageCopyResult {
    pub source_page_id: String,
    pub page_id: String,
    pub document_id: String,
    pub block_ids: std::collections::BTreeMap<String, String>,
    pub document_ids: std::collections::BTreeMap<String, String>,
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
