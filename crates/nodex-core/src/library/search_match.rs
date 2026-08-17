use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SearchTermMatchQuality {
    Exact,
    Prefix,
    Fuzzy,
}

pub(super) fn search_tokens(value: &str) -> Vec<String> {
    normalize_search_text(value)
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect()
}

pub(super) fn normalize_search_text(value: &str) -> String {
    value
        .nfkc()
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn fuzzy_distance(term: &str) -> usize {
    let length = term.chars().count();
    if length <= 3 {
        return 0;
    }
    let threshold = if length <= 5 { 0.1 } else { 0.2 };
    (((length as f64) * threshold).round() as usize).min(6)
}

#[cfg(test)]
mod tests {
    use super::{fuzzy_distance, normalize_search_text, search_tokens};

    #[test]
    fn normalizes_page_search_text_once_for_all_core_consumers() {
        assert_eq!(normalize_search_text("  ＰＡＧＥ\nSearch  "), "page search");
        assert_eq!(search_tokens("  Page\nSearch  "), ["page", "search"]);
        assert_eq!(fuzzy_distance("page"), 0);
        assert_eq!(fuzzy_distance("presrve"), 1);
        assert_eq!(fuzzy_distance(&"x".repeat(100)), 6);
    }
}
