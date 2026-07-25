//! Narrow runtime primitives shared by deep Modules.

pub mod agent_operations;
pub mod collection_window;
pub mod cursor;
pub mod document_repository;
pub mod event_log;
pub(crate) mod legacy_migration;
pub mod metrics;
pub mod migration;
pub mod module_receipts;
pub mod projection_impact;
pub mod schema;
pub mod sqlite;
pub mod store;
pub mod store_lock;
pub mod store_replacement;
pub mod writer;
