#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SearchTermMatchQuality {
    Exact,
    Prefix,
    Fuzzy,
}

pub(super) fn search_tokens(value: &str) -> Vec<String> {
    value
        .trim()
        .to_lowercase()
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect()
}

pub(super) fn field_match_quality(
    text: &str,
    term: &str,
    allow_fuzzy: bool,
) -> Option<SearchTermMatchQuality> {
    let tokens = search_tokens(text);
    if tokens.iter().any(|token| token == term) {
        return Some(SearchTermMatchQuality::Exact);
    }
    if term.chars().count() >= 2 && tokens.iter().any(|token| token.starts_with(term)) {
        return Some(SearchTermMatchQuality::Prefix);
    }
    if !allow_fuzzy {
        return None;
    }
    let maximum = fuzzy_distance(term);
    (maximum > 0
        && tokens
            .iter()
            .any(|token| levenshtein(token, term) <= maximum))
    .then_some(SearchTermMatchQuality::Fuzzy)
}

fn fuzzy_distance(term: &str) -> usize {
    let length = term.chars().count();
    if length <= 3 {
        return 0;
    }
    let threshold = if length <= 5 { 0.1 } else { 0.2 };
    ((length as f64) * threshold).round() as usize
}

fn levenshtein(left: &str, right: &str) -> usize {
    let right = right.chars().collect::<Vec<_>>();
    let mut previous = (0..=right.len()).collect::<Vec<_>>();
    for (left_index, left_character) in left.chars().enumerate() {
        let mut current = vec![left_index + 1];
        for (right_index, right_character) in right.iter().enumerate() {
            current.push(
                (previous[right_index + 1] + 1)
                    .min(current[right_index] + 1)
                    .min(previous[right_index] + usize::from(left_character != *right_character)),
            );
        }
        previous = current;
    }
    previous[right.len()]
}

#[cfg(test)]
mod tests {
    use super::{SearchTermMatchQuality, field_match_quality};

    #[test]
    fn shares_the_page_search_fuzzy_threshold() {
        assert_eq!(
            field_match_quality("Preserve identity", "presrve", true),
            Some(SearchTermMatchQuality::Fuzzy),
        );
        assert_eq!(
            field_match_quality("Canonical", "ca", true),
            Some(SearchTermMatchQuality::Prefix)
        );
        assert_eq!(field_match_quality("Page", "pge", true), None);
    }
}
