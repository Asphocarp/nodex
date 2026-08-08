use std::fmt;

pub(crate) const MIN_PAGE_KEY_PREFIX_LENGTH: usize = 2;
pub(crate) const MAX_PAGE_KEY_PREFIX_LENGTH: usize = 8;
const MAX_SUGGESTED_PREFIX_LENGTH: usize = 5;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct PageKeyPrefix(String);

impl PageKeyPrefix {
    pub(crate) fn parse_requested(raw: &str) -> Result<Self, PageKeyParseError> {
        if !raw.is_ascii() {
            return Err(PageKeyParseError::InvalidPrefix);
        }
        let normalized = raw.to_ascii_uppercase();
        if !is_valid_normalized_prefix(&normalized) {
            return Err(PageKeyParseError::InvalidPrefix);
        }
        Ok(Self(normalized))
    }

    fn from_normalized(normalized: String) -> Self {
        debug_assert!(is_valid_normalized_prefix(&normalized));
        Self(normalized)
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn into_string(self) -> String {
        self.0
    }
}

impl fmt::Display for PageKeyPrefix {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ParsedPageKey {
    pub(crate) normalized_prefix: PageKeyPrefix,
    pub(crate) number: i64,
}

impl ParsedPageKey {
    pub(crate) fn canonical(&self) -> String {
        format!("{}-{}", self.normalized_prefix, self.number)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PageKeyParseError {
    InvalidPrefix,
    InvalidPageKey,
}

pub(crate) fn parse_canonical_page_key(raw: &str) -> Result<ParsedPageKey, PageKeyParseError> {
    let Some((prefix, number)) = raw.split_once('-') else {
        return Err(PageKeyParseError::InvalidPageKey);
    };
    if prefix != prefix.to_ascii_uppercase() || number.contains('-') {
        return Err(PageKeyParseError::InvalidPageKey);
    }
    let normalized_prefix =
        PageKeyPrefix::parse_requested(prefix).map_err(|_| PageKeyParseError::InvalidPageKey)?;
    let number = parse_positive_number(number)?;
    Ok(ParsedPageKey {
        normalized_prefix,
        number,
    })
}

pub(crate) fn parse_page_key_search_candidates(raw: &str) -> Vec<ParsedPageKey> {
    let raw = raw.trim();
    if raw.is_empty() || !raw.is_ascii() {
        return Vec::new();
    }
    let without_marker = raw.strip_prefix('#').unwrap_or(raw);
    if without_marker.is_empty() || without_marker.starts_with('#') {
        return Vec::new();
    }
    let normalized = without_marker.to_ascii_uppercase();
    if normalized.contains('-') {
        return parse_canonical_page_key(&normalized)
            .ok()
            .into_iter()
            .collect();
    }

    let mut candidates = Vec::new();
    let maximum_prefix_length = MAX_PAGE_KEY_PREFIX_LENGTH.min(normalized.len().saturating_sub(1));
    for split_at in MIN_PAGE_KEY_PREFIX_LENGTH..=maximum_prefix_length {
        let prefix = &normalized[..split_at];
        let number = &normalized[split_at..];
        let Ok(normalized_prefix) = PageKeyPrefix::parse_requested(prefix) else {
            continue;
        };
        let Ok(number) = parse_positive_number(number) else {
            continue;
        };
        candidates.push(ParsedPageKey {
            normalized_prefix,
            number,
        });
    }
    candidates
}

pub(crate) fn is_explicit_page_key_search(raw: &str) -> bool {
    raw.trim().starts_with('#')
}

pub(crate) fn suggest_page_key_prefix(project_name: &str) -> PageKeyPrefix {
    let raw_tokens = project_name
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    let tokens = raw_tokens
        .iter()
        .position(|token| token.bytes().any(|byte| byte.is_ascii_alphabetic()))
        .map(|first_letter_token| {
            let mut tokens = Vec::with_capacity(raw_tokens.len() - first_letter_token);
            if let Some(first) = token_from_first_letter(raw_tokens[first_letter_token]) {
                tokens.push(first);
            }
            tokens.extend(raw_tokens[(first_letter_token + 1)..].iter().copied());
            tokens
        })
        .unwrap_or_default();

    let candidate = if tokens.len() >= 2 {
        tokens
            .iter()
            .filter_map(|token| token.as_bytes().first().copied())
            .take(MAX_SUGGESTED_PREFIX_LENGTH)
            .map(char::from)
            .collect::<String>()
    } else {
        tokens
            .first()
            .map(|token| {
                token
                    .chars()
                    .take(MAX_SUGGESTED_PREFIX_LENGTH)
                    .collect::<String>()
            })
            .unwrap_or_default()
    };
    let mut normalized = candidate.to_ascii_uppercase();
    if normalized.len() == 1 {
        normalized.push('X');
    }
    if !is_valid_normalized_prefix(&normalized) {
        normalized = "NX".to_owned();
    }
    PageKeyPrefix::from_normalized(normalized)
}

fn token_from_first_letter(token: &str) -> Option<&str> {
    let first_letter = token.as_bytes().iter().position(u8::is_ascii_alphabetic)?;
    Some(&token[first_letter..])
}

fn parse_positive_number(raw: &str) -> Result<i64, PageKeyParseError> {
    if raw.is_empty()
        || !raw.bytes().all(|byte| byte.is_ascii_digit())
        || (raw.len() > 1 && raw.starts_with('0'))
    {
        return Err(PageKeyParseError::InvalidPageKey);
    }
    let number = raw
        .parse::<i64>()
        .map_err(|_| PageKeyParseError::InvalidPageKey)?;
    if number <= 0 {
        return Err(PageKeyParseError::InvalidPageKey);
    }
    Ok(number)
}

fn is_valid_normalized_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    (MIN_PAGE_KEY_PREFIX_LENGTH..=MAX_PAGE_KEY_PREFIX_LENGTH).contains(&bytes.len())
        && bytes.first().is_some_and(u8::is_ascii_uppercase)
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    struct PageKeyVectors {
        prefixes: Vec<PrefixVector>,
        suggestions: Vec<SuggestionVector>,
        searches: Vec<SearchVector>,
    }

    #[derive(Deserialize)]
    struct PrefixVector {
        input: String,
        canonical: Option<String>,
    }

    #[derive(Deserialize)]
    struct SuggestionVector {
        name: String,
        prefix: String,
    }

    #[derive(Deserialize)]
    struct SearchVector {
        input: String,
        candidates: Vec<String>,
    }

    fn conformance_vectors() -> PageKeyVectors {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/page-key-vectors.json"
        )))
        .expect("Page-key conformance fixture")
    }

    #[test]
    fn page_key_prefixes_normalize_case_and_enforce_the_canonical_grammar() {
        for vector in conformance_vectors().prefixes {
            match vector.canonical {
                Some(canonical) => assert_eq!(
                    PageKeyPrefix::parse_requested(&vector.input)
                        .expect("valid fixture prefix")
                        .as_str(),
                    canonical.as_str(),
                    "{}",
                    vector.input,
                ),
                None => assert_eq!(
                    PageKeyPrefix::parse_requested(&vector.input),
                    Err(PageKeyParseError::InvalidPrefix),
                    "{}",
                    vector.input,
                ),
            }
        }
        for invalid in ["", " LAB"] {
            assert_eq!(
                PageKeyPrefix::parse_requested(invalid),
                Err(PageKeyParseError::InvalidPrefix)
            );
        }
    }

    #[test]
    fn canonical_page_keys_reject_noncanonical_numbers_and_case() {
        let parsed = parse_canonical_page_key("LAB-13").expect("canonical key");
        assert_eq!(parsed.normalized_prefix.as_str(), "LAB");
        assert_eq!(parsed.number, 13);
        assert_eq!(parsed.canonical(), "LAB-13");
        assert_eq!(
            parse_canonical_page_key("PROJECT8-9223372036854775807")
                .expect("i64 maximum remains representable")
                .number,
            i64::MAX
        );

        for invalid in [
            "lab-13",
            "#LAB-13",
            "LAB13",
            "LAB-0",
            "LAB-01",
            "LAB--1",
            "LAB-9223372036854775808",
        ] {
            assert_eq!(
                parse_canonical_page_key(invalid),
                Err(PageKeyParseError::InvalidPageKey),
                "{invalid}"
            );
        }
    }

    #[test]
    fn search_input_accepts_explicit_human_shorthand_without_guessing_a_prefix() {
        for vector in conformance_vectors().searches {
            assert_eq!(
                parse_page_key_search_candidates(&vector.input)
                    .iter()
                    .map(ParsedPageKey::canonical)
                    .collect::<Vec<_>>(),
                vector.candidates,
                "{}",
                vector.input,
            );
        }
        assert!(is_explicit_page_key_search(" #LAB-13 "));
        assert!(!is_explicit_page_key_search("LAB-13"));
    }

    #[test]
    fn project_name_suggestions_are_ascii_deterministic_and_bounded() {
        for vector in conformance_vectors().suggestions {
            assert_eq!(
                suggest_page_key_prefix(&vector.name).as_str(),
                vector.prefix,
                "{}",
                vector.name,
            );
        }
    }
}
