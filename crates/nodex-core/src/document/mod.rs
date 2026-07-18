mod yrs_engine;

pub use yrs_engine::{create_compatible_document, has_pending_dependencies};

#[derive(Default)]
pub struct OwnedDocumentModule;
