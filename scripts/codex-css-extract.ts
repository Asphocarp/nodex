type CssNode = {
  prelude: string;
  body: string;
  children: CssNode[];
};

type CssMatch = {
  prelude: string;
  body: string;
  parents: string[];
};

const stripComments = (value: string): string =>
  value.replace(/\/\*[\s\S]*?\*\//g, " ");

const normalizeCssPrelude = (value: string): string =>
  stripComments(value).replace(/\s+/g, " ").trim();

const parseCssNodes = (
  css: string,
  start = 0,
  end = css.length,
): CssNode[] => {
  const nodes: CssNode[] = [];
  let cursor = start;

  while (cursor < end) {
    const openBraceIndex = css.indexOf("{", cursor);
    if (openBraceIndex === -1 || openBraceIndex >= end) {
      break;
    }

    const prelude = normalizeCssPrelude(css.slice(cursor, openBraceIndex));
    let depth = 1;
    let cursorIndex = openBraceIndex + 1;

    while (cursorIndex < end && depth > 0) {
      const character = css[cursorIndex];
      if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
      }
      cursorIndex += 1;
    }

    const body = css.slice(openBraceIndex + 1, cursorIndex - 1);
    nodes.push({
      prelude,
      body,
      children: parseCssNodes(body),
    });
    cursor = cursorIndex;
  }

  return nodes;
};

const flattenCssNodes = (
  nodes: CssNode[],
  parents: string[] = [],
): CssMatch[] => {
  const matches: CssMatch[] = [];

  for (const node of nodes) {
    matches.push({
      prelude: node.prelude,
      body: node.body,
      parents,
    });
    matches.push(...flattenCssNodes(node.children, [...parents, node.prelude]));
  }

  return matches;
};

const findMatches = (
  matches: CssMatch[],
  selector: string,
  parents: string[] = [],
): CssMatch[] => {
  const normalizedSelector = normalizeCssPrelude(selector);
  const normalizedParents = parents.map(normalizeCssPrelude);

  return matches.filter((match) => {
    if (match.prelude !== normalizedSelector) {
      return false;
    }

    if (match.parents.length !== normalizedParents.length) {
      return false;
    }

    return normalizedParents.every((parent, index) => match.parents[index] === parent);
  });
};

const extractNamedDeclarations = (
  body: string,
  propertyNames: readonly string[],
): Map<string, string> => {
  const declarations = new Map<string, string>();
  const propertySet = new Set(propertyNames);
  const pattern = /(?:(?:^|(?<=[;]))\s*)(--[A-Za-z0-9_.\\-]+)\s*:\s*([^;}]*)/g;

  for (const match of body.matchAll(pattern)) {
    const name = match[1];
    if (!propertySet.has(name)) {
      continue;
    }

    const value = match[2].replace(/\s+/g, " ").trim();
    declarations.set(name, value);
  }

  return declarations;
};

const extractAllDeclarations = (body: string): Map<string, string> => {
  const declarations = new Map<string, string>();
  const pattern = /(?:(?:^|(?<=[;]))\s*)([A-Za-z0-9_.\\-]+)\s*:\s*([^;}]*)/g;

  for (const match of body.matchAll(pattern)) {
    const name = match[1];
    const value = match[2].replace(/\s+/g, " ").trim();
    declarations.set(name, value);
  }

  return declarations;
};

const mergeDeclarationMaps = (maps: Map<string, string>[]): Map<string, string> => {
  const merged = new Map<string, string>();

  for (const map of maps) {
    for (const [name, value] of map.entries()) {
      merged.set(name, value);
    }
  }

  return merged;
};

const formatDeclarations = (declarations: Map<string, string>): string =>
  [...declarations.entries()]
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");

const normalizeRawCssBody = (body: string): string =>
  body
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");

const formatBlock = (selector: string, declarations: Map<string, string>): string =>
  `${selector} {\n${formatDeclarations(declarations)}\n}`;

const formatThemeBlock = (declarations: Map<string, string>): string =>
  `@theme static {\n${formatDeclarations(declarations)}\n}`;

const formatNestedBlock = (
  prelude: string,
  selector: string,
  declarations: Map<string, string>,
): string =>
  `${prelude} {\n${formatBlock(selector, declarations)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}\n}`;

export {
  extractAllDeclarations,
  extractNamedDeclarations,
  findMatches,
  flattenCssNodes,
  formatBlock,
  formatNestedBlock,
  formatThemeBlock,
  mergeDeclarationMaps,
  normalizeRawCssBody,
  normalizeCssPrelude,
  parseCssNodes,
};
