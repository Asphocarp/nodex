#![forbid(unsafe_code)]

pub mod administration;
pub mod automation;
pub mod block_record_module;
pub mod content_store;
pub mod database;
pub mod document;
pub mod domain;
pub mod infrastructure;
pub mod library;
pub mod local_commit;
pub mod mutation_kernel;
pub mod workspace;

#[cfg(test)]
mod read_budget_gate;

pub struct CoreModules {
    pub library: library::LibraryModule,
    pub database: database::DatabaseModule,
    pub document: document::OwnedDocumentModule,
    pub workspace: workspace::ProjectWorkspaceModule,
    pub automation: automation::AutomationModule,
    pub administration: administration::StoreAdministrationModule,
}
