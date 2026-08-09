//! Narrow runtime primitives shared by deep Modules.

pub mod agent_operations;
pub(crate) mod authorized_delivery;
pub mod collection_window;
pub mod cursor;
pub(crate) mod delivery_atom;
pub mod document_repository;
pub(crate) mod durable_mutation;
pub mod event_log;
pub(crate) mod legacy_migration;
pub(crate) mod local_commit;
pub mod metrics;
pub mod migration;
pub mod module_receipts;
pub mod projection_impact;
pub(crate) mod projection_requirement_extractor;
pub(crate) mod projection_scope_head;
pub(crate) mod resource_authorization;
pub mod schema;
pub mod sqlite;
pub mod store;
pub mod store_lock;
pub mod store_replacement;
pub(crate) mod visibility_delta_journal;
pub mod writer;
