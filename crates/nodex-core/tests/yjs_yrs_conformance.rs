use std::path::PathBuf;

use nodex_core::document::{create_compatible_document, has_pending_dependencies};
use yrs::sync::{Awareness, AwarenessUpdate};
use yrs::updates::decoder::Decode;
use yrs::{ClientID, GetString, ReadTxn, StateVector, Transact, Update};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/yjs-yrs")
        .join(name)
}

fn normalize_xml_attributes(xml: &str) -> String {
    let mut normalized = String::with_capacity(xml.len());
    let mut remaining = xml;
    while let Some(start) = remaining.find('<') {
        normalized.push_str(&remaining[..start]);
        let after_start = &remaining[start..];
        let Some(end) = after_start.find('>') else {
            normalized.push_str(after_start);
            return normalized;
        };
        let tag = &after_start[1..end];
        if tag.starts_with('/') {
            normalized.push('<');
            normalized.push_str(tag);
            normalized.push('>');
            remaining = &after_start[end + 1..];
            continue;
        }

        let name_end = tag.find(char::is_whitespace).unwrap_or(tag.len());
        let name = &tag[..name_end];
        let mut attributes = Vec::new();
        let mut source = &tag[name_end..];
        loop {
            source = source.trim_start();
            if source.is_empty() {
                break;
            }
            let Some(equals) = source.find('=') else {
                break;
            };
            let key = source[..equals].trim();
            let value_source = &source[equals + 1..];
            if !value_source.starts_with('"') {
                break;
            }
            let Some(quote_end) = value_source[1..].find('"') else {
                break;
            };
            let value = &value_source[..quote_end + 2];
            attributes.push(format!("{key}={value}"));
            source = &value_source[quote_end + 2..];
        }
        attributes.sort();
        normalized.push('<');
        normalized.push_str(name);
        for attribute in attributes {
            normalized.push(' ');
            normalized.push_str(&attribute);
        }
        normalized.push('>');
        remaining = &after_start[end + 1..];
    }
    normalized.push_str(remaining);
    normalized
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

#[test]
fn registered_schema_matrix_survives_checkpoint_and_history_reconstruction() {
    let base = std::fs::read(fixture("matrix-base.bin")).expect("matrix base exists");
    let expected_vector = StateVector::decode_v1(
        std::fs::read(fixture("matrix-state-vector.bin"))
            .expect("matrix state vector exists")
            .as_slice(),
    )
    .expect("valid Yjs state vector");
    let document = create_compatible_document("nodex-yjs-yrs-schema-matrix");
    document
        .transact_mut()
        .apply_update(Update::decode_v1(&base).expect("valid matrix update"))
        .expect("matrix applies");

    let title = document.get_or_insert_text("title");
    let body = document.get_or_insert_xml_fragment("body");
    let before = document.transact();
    assert_eq!(before.state_vector(), expected_vector);
    let expected_title = title.get_string(&before);
    let expected_body = body.get_string(&before);
    let checkpoint = before.encode_state_as_update_v1(&StateVector::default());
    drop(before);

    let after = std::fs::read(fixture("matrix-after.bin")).expect("matrix delta exists");
    let mut transaction = document.transact_mut();
    transaction
        .apply_update(Update::decode_v1(&after).expect("valid matrix delta"))
        .expect("matrix delta applies");
    assert!(!has_pending_dependencies(&transaction));
    drop(transaction);

    let restored = create_compatible_document("nodex-yjs-yrs-restored-snapshot");
    restored
        .transact_mut()
        .apply_update(Update::decode_v1(&checkpoint).expect("valid checkpoint update"))
        .expect("checkpoint update applies");
    let restored_title = restored.get_or_insert_text("title");
    let restored_body = restored.get_or_insert_xml_fragment("body");
    let restored_transaction = restored.transact();
    assert_eq!(
        restored_title.get_string(&restored_transaction),
        expected_title
    );
    assert_eq!(
        normalize_xml_attributes(&restored_body.get_string(&restored_transaction)),
        normalize_xml_attributes(&expected_body)
    );
}

#[test]
fn awareness_join_and_leave_updates_are_y_protocol_compatible() {
    let mut awareness = Awareness::new(create_compatible_document("nodex-awareness-rust"));
    let added = AwarenessUpdate::decode_v1(
        std::fs::read(fixture("awareness-added.bin"))
            .expect("awareness join exists")
            .as_slice(),
    )
    .expect("valid y-protocol awareness join");
    let added_summary = awareness
        .apply_update_summary(added)
        .expect("join applies")
        .expect("join changes state");
    let fixture_client = ClientID::new(1_201);
    assert_eq!(added_summary.added, vec![fixture_client]);
    assert_eq!(
        awareness.state::<serde_json::Value>(fixture_client),
        Some(serde_json::json!({
            "user": { "id": "fixture-user", "name": "迁移 😀" },
            "cursor": { "anchor": 3, "head": 5 },
        }))
    );

    let removed = AwarenessUpdate::decode_v1(
        std::fs::read(fixture("awareness-removed.bin"))
            .expect("awareness leave exists")
            .as_slice(),
    )
    .expect("valid y-protocol awareness leave");
    let removed_summary = awareness
        .apply_update_summary(removed)
        .expect("leave applies")
        .expect("leave changes state");
    assert_eq!(removed_summary.removed, vec![fixture_client]);
    assert_eq!(awareness.state::<serde_json::Value>(fixture_client), None);
}

#[test]
fn generated_client_identifiers_fit_yjs_13() {
    let document = create_compatible_document("nodex-small-client");
    assert!(document.client_id().get() <= u64::from(u32::MAX));
}
