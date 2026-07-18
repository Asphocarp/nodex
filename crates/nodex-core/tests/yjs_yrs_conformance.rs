use std::path::PathBuf;

use nodex_core::document::{create_compatible_document, has_pending_dependencies};
use yrs::updates::decoder::Decode;
use yrs::{ReadTxn, Transact, Update};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/yjs-yrs")
        .join(name)
}

#[test]
fn accepts_complete_yjs_page_updates_without_pending_dependencies() {
    let document = create_compatible_document("nodex-yjs-yrs-complete");
    for name in ["base.bin", "first.bin", "second.bin"] {
        let bytes = std::fs::read(fixture(name)).expect("fixture exists");
        let update = Update::decode_v1(bytes.as_slice()).expect("valid Yjs V1 update");
        let mut transaction = document.transact_mut();
        transaction.apply_update(update).expect("update applies");
        assert!(!has_pending_dependencies(&transaction), "fixture {name}");
    }
}

#[test]
fn detects_an_incremental_update_with_a_missing_causal_base() {
    let bytes = std::fs::read(fixture("missing-dependency.bin")).expect("fixture exists");
    let update = Update::decode_v1(bytes.as_slice()).expect("valid Yjs V1 update");
    let document = create_compatible_document("nodex-yjs-yrs-pending");
    let mut transaction = document.transact_mut();
    transaction
        .apply_update(update)
        .expect("Yrs retains a causally incomplete update");
    assert!(has_pending_dependencies(&transaction));
    assert!(transaction.store().pending_update().is_some());
}
