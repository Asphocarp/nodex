//! Compile-time inventory of every public Core read shape.
//!
//! A new read variant must be deliberately assigned one of these budget
//! policies before this crate's tests compile. This is intentionally an
//! exhaustive match rather than a source-text assertion: it audits the
//! protocol surface and makes the review obligation follow the type.

use crate::administration::StoreAdministrationRead;
use crate::automation::AutomationRead;
use crate::database::DatabaseReadMode;
use crate::document::OwnedDocumentRead;
use crate::library::LibraryRead;
use crate::workspace::ProjectWorkspaceRead;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReadBudgetPolicy {
    /// A cursor-reachable collection whose response is assembled under the
    /// ordinary collection item and encoded-byte budgets.
    CollectionWindow,
    /// A single entity or fixed-size status/projection read.
    Identity,
    /// Caller supplies a collection with an ingress count/byte bound.
    BoundedBatch,
    /// The domain itself has an enforced finite cardinality/depth.
    FixedDomain,
    /// A deliberately wide object using an identity-scoped Document, binary,
    /// or file-lease transport.
    LargeObject,
}

fn workspace_policy(read: &ProjectWorkspaceRead) -> ReadBudgetPolicy {
    match read {
        ProjectWorkspaceRead::ProjectWindow { .. }
        | ProjectWorkspaceRead::TaskWindow { .. }
        | ProjectWorkspaceRead::SidebarOverview { .. }
        | ProjectWorkspaceRead::ChildThreadWindow { .. }
        | ProjectWorkspaceRead::BackgroundProcessWindow { .. }
        | ProjectWorkspaceRead::ManagedWorktreeWindow { .. } => ReadBudgetPolicy::CollectionWindow,
        ProjectWorkspaceRead::ProjectActivitySummaries { .. } => ReadBudgetPolicy::BoundedBatch,
        ProjectWorkspaceRead::ProjectBootstrap
        | ProjectWorkspaceRead::Project { .. }
        | ProjectWorkspaceRead::ProjectPermissionMode { .. }
        | ProjectWorkspaceRead::ProjectlessPermissionMode
        | ProjectWorkspaceRead::Session { .. }
        | ProjectWorkspaceRead::Thread { .. }
        | ProjectWorkspaceRead::ExecutionContext { .. }
        | ProjectWorkspaceRead::TurnAuthority { .. } => ReadBudgetPolicy::Identity,
    }
}

fn database_policy(mode: DatabaseReadMode) -> ReadBudgetPolicy {
    match mode {
        DatabaseReadMode::CatalogWindow
        | DatabaseReadMode::DataSourceWindow
        | DatabaseReadMode::PropertyWindow
        | DatabaseReadMode::OptionWindow
        | DatabaseReadMode::ViewDescriptorWindow
        | DatabaseReadMode::AgentQuery
        | DatabaseReadMode::ViewWindow
        | DatabaseReadMode::ViewContext
        | DatabaseReadMode::RelationTargetWindow
        | DatabaseReadMode::RelationCandidateWindow => ReadBudgetPolicy::CollectionWindow,
        DatabaseReadMode::RowsById => ReadBudgetPolicy::BoundedBatch,
        // Group summaries are capped at MAX_VIEW_GROUP_SUMMARIES with an
        // explicit truncation flag, so the response cardinality is finite.
        DatabaseReadMode::ViewGroups => ReadBudgetPolicy::FixedDomain,
        DatabaseReadMode::Database
        | DatabaseReadMode::DataSource
        | DatabaseReadMode::View
        | DatabaseReadMode::RowDetail => ReadBudgetPolicy::Identity,
    }
}

fn automation_policy(read: &AutomationRead) -> ReadBudgetPolicy {
    match read {
        AutomationRead::Definitions { .. }
        | AutomationRead::Leases { .. }
        | AutomationRead::Runs { .. }
        | AutomationRead::Inbox { .. }
        | AutomationRead::Occurrences { .. }
        | AutomationRead::ReminderLeases { .. }
        | AutomationRead::ReminderSnoozes { .. } => ReadBudgetPolicy::CollectionWindow,
        AutomationRead::Definition { .. } | AutomationRead::Run { .. } => {
            ReadBudgetPolicy::Identity
        }
    }
}

fn administration_policy(read: &StoreAdministrationRead) -> ReadBudgetPolicy {
    match read {
        StoreAdministrationRead::Backups { .. } => ReadBudgetPolicy::CollectionWindow,
        StoreAdministrationRead::Status | StoreAdministrationRead::MaintenanceStatus => {
            ReadBudgetPolicy::Identity
        }
    }
}

fn document_policy(read: &OwnedDocumentRead) -> ReadBudgetPolicy {
    match read {
        OwnedDocumentRead::ListVersions { .. }
        | OwnedDocumentRead::AgentSemanticSnapshot { .. } => ReadBudgetPolicy::CollectionWindow,
        OwnedDocumentRead::Descriptor { .. }
        | OwnedDocumentRead::GetVersion { .. }
        | OwnedDocumentRead::CanvasCompactionEligibility { .. } => ReadBudgetPolicy::Identity,
        OwnedDocumentRead::PrepareAgentSemanticMutation { .. } => ReadBudgetPolicy::BoundedBatch,
        OwnedDocumentRead::SyncYjs { .. } | OwnedDocumentRead::FetchUpdate { .. } => {
            ReadBudgetPolicy::LargeObject
        }
    }
}

fn library_policy(read: &LibraryRead) -> ReadBudgetPolicy {
    match read {
        LibraryRead::Children { .. }
        | LibraryRead::StandaloneRoots { .. }
        | LibraryRead::Catalog { .. }
        | LibraryRead::AgentSearch { .. }
        | LibraryRead::Search { .. }
        | LibraryRead::PageHistory { .. } => ReadBudgetPolicy::CollectionWindow,
        LibraryRead::Path { .. } | LibraryRead::PageOwnershipPath { .. } => {
            ReadBudgetPolicy::FixedDomain
        }
        LibraryRead::ProjectPageSearch { .. }
        | LibraryRead::PlanAgentResourceAccess { .. }
        | LibraryRead::PrepareAgentPageCopy { .. }
        | LibraryRead::PrepareAgentCreatePages { .. }
        | LibraryRead::PrepareAgentMovePages { .. } => ReadBudgetPolicy::BoundedBatch,
        LibraryRead::PageContent { .. } | LibraryRead::PageFile { .. } => {
            ReadBudgetPolicy::LargeObject
        }
        LibraryRead::Metadata
        | LibraryRead::ResourceProjectAccess { .. }
        | LibraryRead::FilterProjectionImpactForProject { .. }
        | LibraryRead::PageDetail { .. }
        | LibraryRead::PageDraftProjection { .. }
        | LibraryRead::AcquireSearchSnapshot { .. }
        | LibraryRead::ReleaseSearchSnapshot { .. }
        | LibraryRead::AgentBlockTarget { .. }
        | LibraryRead::PageTarget { .. }
        | LibraryRead::CanvasTarget { .. }
        | LibraryRead::PageLocation { .. }
        | LibraryRead::ViewLocation { .. }
        | LibraryRead::PageLifecyclePreflight { .. } => ReadBudgetPolicy::Identity,
    }
}

#[test]
fn every_read_variant_has_an_explicit_budget_policy() {
    assert_eq!(
        database_policy(DatabaseReadMode::CatalogWindow),
        ReadBudgetPolicy::CollectionWindow
    );
    assert_eq!(
        workspace_policy(&ProjectWorkspaceRead::Project {
            project_id: "project:audit".to_owned(),
        }),
        ReadBudgetPolicy::Identity
    );
    assert_eq!(
        automation_policy(&AutomationRead::Inbox {
            window: Default::default(),
        }),
        ReadBudgetPolicy::CollectionWindow
    );
    assert_eq!(
        administration_policy(&StoreAdministrationRead::Status),
        ReadBudgetPolicy::Identity
    );
    assert_eq!(
        document_policy(&OwnedDocumentRead::SyncYjs {
            document_id: "document:audit".to_owned(),
            state_vector: Vec::new(),
        }),
        ReadBudgetPolicy::LargeObject
    );
    assert_eq!(
        library_policy(&LibraryRead::Metadata),
        ReadBudgetPolicy::Identity
    );
}
