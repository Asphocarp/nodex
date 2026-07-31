const EMPTY_UNRELEASED_SECTION = [
  "## [Unreleased]",
  "",
  "### Added",
  "",
  "### Changed",
  "",
  "### Fixed",
].join("\n");

export interface PreparedChangelog {
  readonly changelogContent: string;
  readonly releaseNotes: string;
}

interface SectionRange {
  readonly content: string;
  readonly end: number;
  readonly start: number;
}

const normalizeContent = (content: string): string => content.replace(/\r\n/g, "\n");
const trimTrailingWhitespace = (content: string): string => content.replace(/[ \t]+$/gm, "");
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasMeaningfulReleaseNotes = (content: string): boolean => content
  .split("\n")
  .map((line) => line.trim())
  .some((line) => line.length > 0 && !line.startsWith("### "));

const trimBlankLines = (lines: readonly string[]): string[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim().length === 0) start += 1;
  while (end > start && lines[end - 1].trim().length === 0) end -= 1;
  return lines.slice(start, end);
};

const omitEmptySubsections = (content: string): string => {
  const normalized = trimTrailingWhitespace(content).trim();
  if (!normalized) return "";

  const blocks: Array<{ heading: string | null; lines: string[] }> = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  for (const line of normalized.split("\n")) {
    if (!line.startsWith("### ")) {
      current.lines.push(line);
      continue;
    }
    blocks.push(current);
    current = { heading: line, lines: [] };
  }
  blocks.push(current);

  return blocks
    .map((block) => {
      const body = trimBlankLines(block.lines);
      if (body.length === 0) return "";
      return block.heading ? `${block.heading}\n${body.join("\n")}` : body.join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
};

const sectionRange = (content: string, headingPattern: RegExp): SectionRange => {
  const normalized = normalizeContent(content);
  const headings = Array.from(normalized.matchAll(/^## \[.*\](?: - \d{4}-\d{2}-\d{2})?$/gm));
  const target = headings.find((match) => headingPattern.test(match[0]));
  if (target?.index === undefined) {
    throw new Error(`Unable to find changelog section matching ${headingPattern}.`);
  }
  const next = headings.find((match) => (match.index ?? 0) > target.index!);
  return {
    content: normalized.slice(target.index, next?.index ?? normalized.length).trim(),
    end: next?.index ?? normalized.length,
    start: target.index,
  };
};

export function extractReleaseNotes(changelogContent: string, version: string): string {
  const section = sectionRange(
    changelogContent,
    new RegExp(`^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}$`),
  );
  const heading = section.content.match(/^## \[.*\] - \d{4}-\d{2}-\d{2}$/m)?.[0];
  if (!heading) throw new Error(`Unable to read the heading for release ${version}.`);
  const notes = section.content.slice(heading.length).trim();
  if (!hasMeaningfulReleaseNotes(notes)) {
    throw new Error(`Release ${version} does not contain any changelog notes.`);
  }
  return `${trimTrailingWhitespace(notes)}\n`;
}

export function prepareChangelog(
  changelogContent: string,
  version: string,
  date: string,
): PreparedChangelog {
  const normalized = normalizeContent(changelogContent);
  const releasedHeading = new RegExp(`^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m");
  if (releasedHeading.test(normalized)) {
    throw new Error(`Release ${version} already exists in CHANGELOG.md.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Release date must use YYYY-MM-DD.");
  }

  const unreleased = sectionRange(normalized, /^## \[Unreleased\]$/);
  const heading = unreleased.content.match(/^## \[Unreleased\]$/m)?.[0];
  if (!heading) throw new Error("Unable to read the Unreleased changelog heading.");
  const notes = omitEmptySubsections(unreleased.content.slice(heading.length).trim());
  if (!hasMeaningfulReleaseNotes(notes)) {
    throw new Error("The Unreleased changelog section is empty. Refusing to prepare a release without notes.");
  }

  const before = normalized.slice(0, unreleased.start).trimEnd();
  const after = normalized.slice(unreleased.end).trimStart();
  const releaseSection = `## [${version}] - ${date}\n\n${notes}`;
  const next = [before, EMPTY_UNRELEASED_SECTION, releaseSection, after]
    .filter(Boolean)
    .join("\n\n");
  return { changelogContent: `${next}\n`, releaseNotes: `${notes}\n` };
}
