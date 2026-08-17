#[cfg(test)]
pub(super) use nodex_page_search_kernel::fuzzy_distance;
pub(super) use nodex_page_search_kernel::{
    MatchQuality as SearchTermMatchQuality, normalize_search_text, search_tokens,
};

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
