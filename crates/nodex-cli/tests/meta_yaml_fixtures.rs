use std::fs;
use std::path::Path;

use nodex_cli::error::CliErrorCode;
use nodex_cli::meta_yaml::{ProjectedPropertyValueV1, compare_draft_metadata, parse};

#[test]
fn accepted_metadata_fixtures_cover_the_closed_projection_types() {
    let complete = read_fixture("accept/all-types.yaml");
    let metadata = parse(&complete).expect("all-types fixture");

    let value = |property_id: &str| {
        &metadata
            .properties
            .iter()
            .find(|property| property.property_id == property_id)
            .unwrap_or_else(|| panic!("missing {property_id} Property"))
            .value
    };

    assert!(matches!(value("text"), ProjectedPropertyValueV1::Text(_)));
    assert!(matches!(
        value("number"),
        ProjectedPropertyValueV1::Number(_)
    ));
    assert!(matches!(
        value("checkbox"),
        ProjectedPropertyValueV1::Checkbox(true)
    ));
    assert!(matches!(
        value("select"),
        ProjectedPropertyValueV1::Identity(_)
    ));
    assert!(matches!(
        value("multi"),
        ProjectedPropertyValueV1::Identities(_)
    ));
    assert!(matches!(value("date"), ProjectedPropertyValueV1::Date(_)));
    assert!(matches!(
        value("datetime"),
        ProjectedPropertyValueV1::Datetime(_)
    ));
    assert!(metadata.schedule.is_some());

    let standalone = parse(&read_fixture("accept/standalone.yaml")).expect("standalone fixture");
    assert!(standalone.properties.is_empty());
    assert!(standalone.schedule.is_none());
}

#[test]
fn formatting_only_fixture_is_semantically_equal() {
    let canonical = parse(&read_fixture("accept/all-types.yaml")).expect("canonical fixture");
    let reordered =
        parse(&read_fixture("accept/all-types-reordered.yaml")).expect("reordered fixture");

    assert_eq!(canonical, reordered);
    assert_eq!(
        compare_draft_metadata(&canonical, &reordered)
            .expect("formatting-only comparison")
            .title,
        None
    );
}

#[test]
fn rejected_metadata_fixtures_have_stable_syntax_or_profile_errors() {
    let directory = fixture_root().join("reject");
    let mut paths = fs::read_dir(directory)
        .expect("rejected fixture directory")
        .map(|entry| entry.expect("fixture entry").path())
        .collect::<Vec<_>>();
    paths.sort();
    assert!(!paths.is_empty());

    for path in paths {
        let error = parse(&fs::read(&path).expect("fixture bytes"))
            .unwrap_err_or_else(|_| panic!("{} must fail", path.display()));
        assert!(
            matches!(
                error.code,
                CliErrorCode::MetaYamlSyntax | CliErrorCode::MetaYamlInvalid
            ),
            "{} returned {:?}",
            path.display(),
            error.code
        );
    }
}

fn fixture_root() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/meta-yaml")
}

fn read_fixture(relative: &str) -> Vec<u8> {
    fs::read(fixture_root().join(relative)).expect("fixture bytes")
}

trait ResultExt<T, E> {
    fn unwrap_err_or_else(self, function: impl FnOnce(T) -> E) -> E;
}

impl<T, E> ResultExt<T, E> for Result<T, E> {
    fn unwrap_err_or_else(self, function: impl FnOnce(T) -> E) -> E {
        match self {
            Ok(value) => function(value),
            Err(error) => error,
        }
    }
}
