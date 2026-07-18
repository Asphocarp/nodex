use yrs::{Doc, OffsetKind, Options, ReadTxn, TransactionMut};

pub fn create_compatible_document(guid: &str) -> Doc {
    let options = Options {
        guid: guid.into(),
        offset_kind: OffsetKind::Utf16,
        ..Options::default()
    };
    Doc::with_options(options)
}

pub fn has_pending_dependencies(transaction: &TransactionMut<'_>) -> bool {
    transaction.store().pending_update().is_some() || transaction.store().pending_ds().is_some()
}

#[cfg(test)]
mod tests {
    use yrs::updates::decoder::Decode;
    use yrs::updates::encoder::Encode;
    use yrs::{GetString, ReadTxn, StateVector, Text, Transact, Update};

    use super::*;

    #[test]
    fn document_offsets_are_utf16_code_units() {
        let document = create_compatible_document("nodex-test");
        let text = document.get_or_insert_text("title");
        let mut transaction = document.transact_mut();
        text.insert(&mut transaction, 0, "A😀中");
        drop(transaction);

        let transaction = document.transact();
        assert_eq!(text.len(&transaction), 4);
        assert_eq!(text.get_string(&transaction), "A😀中");
    }

    #[test]
    fn v1_updates_round_trip_incrementally() {
        let source = create_compatible_document("nodex-source");
        let source_text = source.get_or_insert_text("title");
        source_text.insert(&mut source.transact_mut(), 0, "Nodex");

        let full = source
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let target = create_compatible_document("nodex-target");
        let update = Update::decode_v1(full.as_slice()).expect("valid V1 update");
        let mut transaction = target.transact_mut();
        transaction
            .apply_update(update)
            .expect("complete V1 update applies");
        assert!(!has_pending_dependencies(&transaction));
        drop(transaction);

        assert_eq!(
            target
                .get_or_insert_text("title")
                .get_string(&target.transact()),
            "Nodex"
        );

        let encoded_state_vector = target.transact().state_vector().encode_v1();
        assert!(!encoded_state_vector.is_empty());
    }
}
