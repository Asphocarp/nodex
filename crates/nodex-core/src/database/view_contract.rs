use serde_json::Value;

/// The one View configuration whose row order and group semantics can be
/// shared by primary Board writes and exact singleton projection patches.
pub(crate) fn is_exact_primary_board_config(config: &Value) -> bool {
    let has_empty_filter = config.get("filter").is_some_and(|filter| {
        filter.get("kind").and_then(Value::as_str) == Some("group")
            && filter.get("operator").and_then(Value::as_str) == Some("and")
            && filter
                .get("children")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
    });
    let has_manual_sort = config
        .pointer("/presentation/sort")
        .and_then(Value::as_array)
        .is_some_and(|sort| {
            let [rule] = sort.as_slice() else {
                return false;
            };
            rule.pointer("/field/kind").and_then(Value::as_str) == Some("manual")
                && rule.get("direction").and_then(Value::as_str) == Some("asc")
                && rule.get("nulls").and_then(Value::as_str) == Some("last")
        });
    let has_status_group = config
        .pointer("/presentation/group/propertyId")
        .and_then(Value::as_str)
        == Some("status");
    has_empty_filter && has_manual_sort && has_status_group
}
