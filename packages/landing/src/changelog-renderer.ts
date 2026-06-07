export type ChangelogItem = {
  text: string;
};

export type ChangelogCategory = {
  items: ChangelogItem[];
  title: string;
};

export type ChangelogRelease = {
  categories: ChangelogCategory[];
  date: string | null;
  label: string;
  version: string | null;
};

const releaseHeadingPattern = /^## \[(?<label>[^\]]+)\](?: - (?<date>\d{4}-\d{2}-\d{2}))?$/;
const categoryHeadingPattern = /^### (?<title>.+)$/;

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(value: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < value.length) {
    const openingIndex = value.indexOf("`", cursor);

    if (openingIndex === -1) {
      output += escapeHtml(value.slice(cursor));
      break;
    }

    output += escapeHtml(value.slice(cursor, openingIndex));

    const delimiterLength = countBacktickRun(value, openingIndex);
    const closingIndex = findMatchingBacktickRun(value, openingIndex + delimiterLength, delimiterLength);

    if (closingIndex === -1) {
      output += escapeHtml(value.slice(openingIndex));
      break;
    }

    output += `<code>${escapeHtml(value.slice(openingIndex + delimiterLength, closingIndex))}</code>`;
    cursor = closingIndex + delimiterLength;
  }

  return output;
}

function countBacktickRun(value: string, start: number): number {
  let end = start;

  while (value[end] === "`") {
    end += 1;
  }

  return end - start;
}

function findMatchingBacktickRun(value: string, start: number, delimiterLength: number): number {
  let cursor = start;

  while (cursor < value.length) {
    const nextBacktick = value.indexOf("`", cursor);

    if (nextBacktick === -1) {
      return -1;
    }

    const nextDelimiterLength = countBacktickRun(value, nextBacktick);

    if (nextDelimiterLength === delimiterLength) {
      return nextBacktick;
    }

    cursor = nextBacktick + nextDelimiterLength;
  }

  return -1;
}

function readMeaningfulReleaseCategories(content: string, heading: string): ChangelogCategory[] {
  const categories: ChangelogCategory[] = [];
  let activeCategory: ChangelogCategory | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    const categoryHeading = line.match(categoryHeadingPattern);

    if (categoryHeading?.groups?.title) {
      activeCategory = {
        title: categoryHeading.groups.title.trim(),
        items: [],
      };
      categories.push(activeCategory);
      continue;
    }

    if (line.trim().length === 0) {
      continue;
    }

    if (!line.startsWith("- ")) {
      throw new Error(`Unsupported changelog content in ${heading}: "${line}".`);
    }

    if (!activeCategory) {
      throw new Error(`Changelog bullets must appear below a category heading in ${heading}.`);
    }

    activeCategory.items.push({
      text: line.slice(2).trim(),
    });
  }

  return categories.filter((category) => category.items.length > 0);
}

function parseReleaseHeading(heading: string): Pick<ChangelogRelease, "date" | "label" | "version"> {
  const match = heading.match(releaseHeadingPattern);
  const label = match?.groups?.label;
  const date = match?.groups?.date ?? null;

  if (!label) {
    throw new Error(`Unsupported changelog release heading: "${heading}".`);
  }

  if (label === "Unreleased") {
    if (date) {
      throw new Error("The Unreleased changelog section must not include a date.");
    }

    return {
      date: null,
      label: "Unreleased",
      version: null,
    };
  }

  if (!date) {
    throw new Error(`Release heading "${heading}" must include a YYYY-MM-DD date.`);
  }

  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(label)) {
    throw new Error(`Release heading "${heading}" must use a semver version label.`);
  }

  return {
    date,
    label: `v${label}`,
    version: label,
  };
}

export function parseChangelog(content: string): ChangelogRelease[] {
  const normalizedContent = normalizeContent(content);
  const lines = normalizedContent.split("\n");
  const releaseSections: Array<{ bodyLines: string[]; heading: string }> = [];
  let activeSection: { bodyLines: string[]; heading: string } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("## ")) {
      activeSection = {
        heading: line,
        bodyLines: [],
      };
      releaseSections.push(activeSection);
      continue;
    }

    if (line.startsWith("# ")) {
      continue;
    }

    if (!activeSection) {
      continue;
    }

    activeSection.bodyLines.push(line);
  }

  if (releaseSections.length === 0) {
    throw new Error("Unable to find any changelog release sections.");
  }

  return releaseSections.map((section) => {
    const release = parseReleaseHeading(section.heading);
    const categories = readMeaningfulReleaseCategories(section.bodyLines.join("\n"), section.heading);

    return {
      ...release,
      categories,
    };
  });
}

export function renderChangelogHtml(content: string): string {
  const releases = parseChangelog(content);

  return releases
    .map((release, index) => {
      const isUnreleased = release.version === null;
      const releaseId = isUnreleased ? "unreleased" : `v${release.version}`;
      const dateLabel = isUnreleased ? "In development" : release.date ?? "";
      const categoriesHtml = release.categories
        .map((category) => {
          const itemsHtml = category.items
            .map((item) => `<li>${renderInlineMarkdown(item.text)}</li>`)
            .join("");

          return [
            '<section class="changelog-category">',
            `<h3>${escapeHtml(category.title)}</h3>`,
            `<ul>${itemsHtml}</ul>`,
            "</section>",
          ].join("");
        })
        .join("");

      return [
        `<article class="changelog-release${index === 0 ? " changelog-release-latest" : ""}" id="${releaseId}">`,
        '<header class="changelog-release-header">',
        `<h2>${escapeHtml(release.label)}</h2>`,
        `<p>${escapeHtml(dateLabel)}</p>`,
        "</header>",
        '<div class="changelog-release-body">',
        categoriesHtml,
        "</div>",
        "</article>",
      ].join("");
    })
    .join("");
}
