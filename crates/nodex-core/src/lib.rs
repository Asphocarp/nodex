#![forbid(unsafe_code)]

pub mod administration;
pub mod automation;
pub mod database;
pub mod document;
pub mod domain;
pub mod infrastructure;
pub mod library;
pub mod workspace;

pub struct CoreModules {
    pub library: library::LibraryModule,
    pub database: database::DatabaseModule,
    pub document: document::OwnedDocumentModule,
    pub workspace: workspace::ProjectWorkspaceModule,
    pub automation: automation::AutomationModule,
    pub administration: administration::StoreAdministrationModule,
}
