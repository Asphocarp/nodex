import { expect, test } from "bun:test";

import { parseChangelog, renderChangelogHtml } from "./changelog-renderer";

const sampleChangelog = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Added a public changelog page.

### Changed

## [0.1.2] - 2026-03-13

### Added
- Added release automation with \`bun run release\`.

### Fixed
- Fixed HTML-ish notes like <script>alert("x")</script>.

## [0.1.1] - 2026-03-12

### Fixed
- Fixed older release notes.
`;

test("parseChangelog keeps Unreleased first and labels it as in development", () => {
  const releases = parseChangelog(sampleChangelog);

  expect(releases.length).toBe(3);
  expect(releases[0]?.label).toBe("Unreleased");
  expect(releases[0]?.date).toBe(null);
  expect(releases[0]?.version).toBe(null);

  const html = renderChangelogHtml(sampleChangelog);

  expect(html.includes("<h2>Unreleased</h2>")).toBeTrue();
  expect(html.includes("<p>In development</p>")).toBeTrue();
});

test("parseChangelog renders dated releases with categories and bullets", () => {
  const releases = parseChangelog(sampleChangelog);
  const release = releases[1];

  expect(release?.label).toBe("v0.1.2");
  expect(release?.date).toBe("2026-03-13");
  expect(release?.categories.length).toBe(2);
  expect(release?.categories[0]?.title).toBe("Added");
  expect(release?.categories[0]?.items[0]?.text).toBe("Added release automation with `bun run release`.");
});

test("renderChangelogHtml omits empty category sections", () => {
  const html = renderChangelogHtml(sampleChangelog);

  expect(html.includes("<h3>Changed</h3>")).toBeFalse();
});

test("renderChangelogHtml escapes html and preserves inline code", () => {
  const html = renderChangelogHtml(sampleChangelog);

  expect(html.includes("<code>bun run release</code>")).toBeTrue();
  expect(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")).toBeTrue();
  expect(html.includes("<script>alert")).toBeFalse();
});

test("renderChangelogHtml preserves code spans that contain backticks", () => {
  const html = renderChangelogHtml(`# Changelog

## [Unreleased]

### Fixed
- Fixed default code export as \` \`\`\`text\`.
`);

  expect(html.includes("<code> ```text</code>")).toBeTrue();
  expect(html.includes("<code> </code>`<code>text</code>")).toBeFalse();
});

test("parseChangelog rejects malformed release headings", () => {
  let errorMessage = "";

  try {
    parseChangelog(`# Changelog

## [0.1.2]

### Added
- Added a note.
`);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  expect(errorMessage.includes("must include a YYYY-MM-DD date")).toBeTrue();
});
