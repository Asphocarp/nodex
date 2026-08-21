#![forbid(unsafe_code)]

pub const STORE_LINEAGE: &str = "nodex-rust-core";
pub const MIN_SUPPORTED_STORE_REVISION: u32 = 130;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PublishedStoreFormat {
    pub revision: u32,
    pub schema_fingerprint: &'static str,
}

pub const PUBLISHED_STORE_FORMATS: &[PublishedStoreFormat] = &[
    format(
        130,
        "baedc982cdfd3e48a69c8786eb5da261dd3e34a8320abedf15121f8ded935f93",
    ),
    format(
        131,
        "46dd2a5762d431f063ced596735d7330a12b1bda9854b08eea66ff9a0f81bc8c",
    ),
    format(
        132,
        "4d8a73cef28f743faea9c5718ca7eaae90c4f6473895a3fd872a7cb75e870e90",
    ),
];

pub const CURRENT_STORE_FORMAT: PublishedStoreFormat =
    PUBLISHED_STORE_FORMATS[PUBLISHED_STORE_FORMATS.len() - 1];
pub const CURRENT_STORE_VERSION: u32 = CURRENT_STORE_FORMAT.revision;
pub const CURRENT_STORE_SCHEMA_FINGERPRINT: &str = CURRENT_STORE_FORMAT.schema_fingerprint;

const fn format(revision: u32, schema_fingerprint: &'static str) -> PublishedStoreFormat {
    PublishedStoreFormat {
        revision,
        schema_fingerprint,
    }
}

pub fn published_store_format(revision: u32) -> Option<PublishedStoreFormat> {
    PUBLISHED_STORE_FORMATS
        .binary_search_by_key(&revision, |format| format.revision)
        .ok()
        .map(|index| PUBLISHED_STORE_FORMATS[index])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_contiguous_and_current_is_last() {
        let revisions = PUBLISHED_STORE_FORMATS
            .iter()
            .map(|format| format.revision)
            .collect::<Vec<_>>();
        assert_eq!(
            revisions,
            (MIN_SUPPORTED_STORE_REVISION..=CURRENT_STORE_FORMAT.revision).collect::<Vec<_>>()
        );
        assert_eq!(
            published_store_format(CURRENT_STORE_FORMAT.revision),
            Some(CURRENT_STORE_FORMAT)
        );
    }
}
