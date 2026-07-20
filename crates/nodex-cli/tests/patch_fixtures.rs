use std::fs;
use std::path::Path;

use nodex_cli::error::CliErrorCode;
use nodex_cli::patch;

#[test]
fn accepted_patch_fixtures_compile_to_exact_fragments() {
    let fixtures = fixture_files("accept");
    assert!(
        !fixtures.is_empty(),
        "accepted fixture corpus must not be empty"
    );

    for fixture in fixtures {
        let bytes = fs::read(&fixture).expect("fixture bytes");
        let document = patch::parse(&bytes)
            .unwrap_or_else(|error| panic!("{} must parse: {error}", fixture.display()));
        assert!(document.page_id.starts_with('@'));
        assert!(!document.hunks.is_empty());
        assert!(
            document
                .hunks
                .iter()
                .all(|hunk| !hunk.old_fragment.is_empty())
        );
    }
}

#[test]
fn rejected_patch_fixtures_report_syntax_or_contract_errors() {
    let fixtures = fixture_files("reject");
    assert!(
        !fixtures.is_empty(),
        "rejected fixture corpus must not be empty"
    );

    for fixture in fixtures {
        let bytes = fs::read(&fixture).expect("fixture bytes");
        let error = patch::parse(&bytes)
            .unwrap_err_or_else(|_| panic!("{} must be rejected", fixture.display()));
        assert!(
            matches!(
                error.code,
                CliErrorCode::PatchSyntax | CliErrorCode::PatchInvalid
            ),
            "{} returned {:?}",
            fixture.display(),
            error.code
        );
    }
}

fn fixture_files(kind: &str) -> Vec<std::path::PathBuf> {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/nodex-patch")
        .join(kind);
    let mut entries = fs::read_dir(directory)
        .expect("fixture directory")
        .map(|entry| entry.expect("fixture entry").path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "patch")
        })
        .collect::<Vec<_>>();
    entries.sort();
    entries
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
