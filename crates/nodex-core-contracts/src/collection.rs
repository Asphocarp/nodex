use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const DEFAULT_COLLECTION_WINDOW_ITEMS: u32 = 50;
pub const MAX_COLLECTION_WINDOW_ITEMS: u32 = 200;
pub const MAX_COLLECTION_WINDOW_JSON_BYTES: usize = 1024 * 1024;
pub const MAX_COLLECTION_CURSOR_BYTES: usize = 2 * 1024;

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CollectionWindowRequest {
    pub after: Option<String>,
    pub first: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct CollectionWindowAuthority {
    pub projection_revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct CollectionWindow<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
    pub authority: CollectionWindowAuthority,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_defaults_do_not_smuggle_a_byte_budget() {
        let value = serde_json::to_value(CollectionWindowRequest::default())
            .expect("window request serializes");

        assert_eq!(value, serde_json::json!({ "after": null, "first": null }));
        assert!(value.get("maximum_bytes").is_none());
    }

    #[test]
    fn window_uses_one_opaque_continuation_coordinate() {
        let value = serde_json::to_value(CollectionWindow {
            items: vec!["task-1"],
            next_cursor: Some("nxc1.payload.signature".to_owned()),
            authority: CollectionWindowAuthority {
                projection_revision: 42,
            },
        })
        .expect("window serializes");

        assert_eq!(value["next_cursor"], "nxc1.payload.signature");
        assert_eq!(value["authority"]["projection_revision"], 42);
        assert!(value.get("offset").is_none());
        assert!(value.get("has_more").is_none());
    }
}
