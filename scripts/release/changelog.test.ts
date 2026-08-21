import { expect, test } from "vitest";
import { extractReleaseNotes, prepareChangelog } from "./changelog";

const sample = `# Changelog

## [Unreleased]

### Added
- Added release automation.

### Changed

### Fixed
- Fixed a release edge case.

## [0.1.10] - 2026-05-03

### Added
- Previous release.
`;

test("prepareChangelog rolls meaningful Unreleased notes and keeps a fresh section", () => {
  const result = prepareChangelog(sample, "0.2.0", "2026-07-31");
  expect(result.changelogContent).toContain(
    "## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed",
  );
  expect(result.changelogContent).toContain("## [0.2.0] - 2026-07-31\n\n### Added");
  expect(result.releaseNotes).not.toContain("### Changed");
});

test("extractReleaseNotes returns only the requested release body", () => {
  const prepared = prepareChangelog(sample, "0.2.0", "2026-07-31");
  expect(extractReleaseNotes(prepared.changelogContent, "0.2.0")).toBe(prepared.releaseNotes);
});

test("prepareChangelog rejects empty and duplicate releases", () => {
  expect(() =>
    prepareChangelog("# Changelog\n\n## [Unreleased]\n\n### Added\n", "0.2.0", "2026-07-31"),
  ).toThrow("empty");
  expect(() => prepareChangelog(sample, "0.1.10", "2026-07-31")).toThrow("already exists");
});
