export type CodexFileTreeIconColorName =
  | "blue"
  | "cyan"
  | "gray"
  | "green"
  | "indigo"
  | "mauve"
  | "orange"
  | "pink"
  | "purple"
  | "red"
  | "teal"
  | "vermilion"
  | "yellow";

export type CodexFileTreeIconToken =
  | "astro"
  | "babel"
  | "bash"
  | "biome"
  | "bootstrap"
  | "browserslist"
  | "bun"
  | "c"
  | "claude"
  | "cpp"
  | "css"
  | "database"
  | "default"
  | "docker"
  | "eslint"
  | "font"
  | "git"
  | "go"
  | "graphql"
  | "html"
  | "image"
  | "javascript"
  | "json"
  | "markdown"
  | "mcp"
  | "nextjs"
  | "npm"
  | "oxc"
  | "postcss"
  | "prettier"
  | "python"
  | "react"
  | "ruby"
  | "rust"
  | "sass"
  | "stylelint"
  | "svelte"
  | "svg"
  | "svgo"
  | "swift"
  | "table"
  | "tailwind"
  | "terraform"
  | "text"
  | "typescript"
  | "vite"
  | "vscode"
  | "vue"
  | "wasm"
  | "webpack"
  | "yml"
  | "zig"
  | "zip";

export interface CodexFileTreeIconDescriptor {
  token: CodexFileTreeIconToken;
  name: `file-tree-builtin-${CodexFileTreeIconToken}`;
  viewBox: "0 0 16 16";
}

const CODEX_FILE_TREE_ICON_COLOR_FALLBACKS = {
  blue: "light-dark(#1a85d4, #69b1ff)",
  cyan: "light-dark(#1ca1c7, #68cdf2)",
  gray: "light-dark(#84848a, #adadb1)",
  green: "light-dark(#199f43, #5ecc71)",
  indigo: "light-dark(#693acf, #9d6afb)",
  mauve: "light-dark(#594c5b, #79697b)",
  orange: "light-dark(#d47628, #ffa359)",
  pink: "light-dark(#d32a61, #ff678d)",
  purple: "light-dark(#a631be, #d568ea)",
  red: "light-dark(#d52c36, #ff6762)",
  teal: "light-dark(#17a5af, #64d1db)",
  vermilion: "light-dark(#ff8c5b, #d5512f)",
  yellow: "light-dark(#d5a910, #ffd452)",
} satisfies Record<CodexFileTreeIconColorName, string>;

const CODEX_FILE_TREE_ICON_COLOR_BY_TOKEN: Partial<Record<CodexFileTreeIconToken, CodexFileTreeIconColorName>> = {
  astro: "purple",
  babel: "yellow",
  bash: "green",
  biome: "blue",
  bootstrap: "indigo",
  browserslist: "yellow",
  bun: "mauve",
  c: "blue",
  claude: "orange",
  cpp: "blue",
  css: "indigo",
  database: "purple",
  default: "gray",
  docker: "blue",
  eslint: "indigo",
  git: "vermilion",
  go: "cyan",
  graphql: "pink",
  html: "orange",
  image: "pink",
  javascript: "yellow",
  json: "orange",
  markdown: "green",
  mcp: "teal",
  npm: "red",
  oxc: "cyan",
  postcss: "red",
  prettier: "teal",
  python: "blue",
  react: "cyan",
  ruby: "red",
  rust: "orange",
  sass: "pink",
  svelte: "red",
  svg: "orange",
  svgo: "green",
  swift: "orange",
  table: "teal",
  tailwind: "cyan",
  terraform: "indigo",
  text: "gray",
  typescript: "blue",
  vite: "purple",
  vscode: "blue",
  vue: "green",
  wasm: "indigo",
  webpack: "blue",
  yml: "red",
  zig: "orange",
  zip: "orange",
};

const EXACT_FILE_TOKEN_BY_NAME: Record<string, CodexFileTreeIconToken> = {
  ".babelrc": "babel",
  ".browserslistrc": "browserslist",
  ".dockerignore": "docker",
  ".eslintignore": "eslint",
  ".eslintrc": "eslint",
  ".gitattributes": "git",
  ".gitignore": "git",
  ".graphqlrc": "graphql",
  ".npmrc": "npm",
  ".oxlintrc": "oxc",
  ".prettierignore": "prettier",
  ".prettierrc": "prettier",
  ".stylelintrc": "stylelint",
  ".svgo.yml": "svgo",
  ".svgo.yaml": "svgo",
  "biome.json": "biome",
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "claude.md": "claude",
  "docker-compose.yml": "docker",
  "docker-compose.yaml": "docker",
  dockerfile: "docker",
  "eslint.config.js": "eslint",
  "eslint.config.mjs": "eslint",
  "eslint.config.ts": "eslint",
  "next-env.d.ts": "nextjs",
  "next.config.js": "nextjs",
  "next.config.mjs": "nextjs",
  "next.config.ts": "nextjs",
  "npm-shrinkwrap.json": "npm",
  "oxlint.json": "oxc",
  "package-lock.json": "npm",
  "package.json": "npm",
  "postcss.config.cjs": "postcss",
  "postcss.config.js": "postcss",
  "postcss.config.mjs": "postcss",
  "postcss.config.ts": "postcss",
  "prettier.config.cjs": "prettier",
  "prettier.config.js": "prettier",
  "prettier.config.mjs": "prettier",
  "prettier.config.ts": "prettier",
  "stylelint.config.cjs": "stylelint",
  "stylelint.config.js": "stylelint",
  "stylelint.config.mjs": "stylelint",
  "stylelint.config.ts": "stylelint",
  "tailwind.config.cjs": "tailwind",
  "tailwind.config.js": "tailwind",
  "tailwind.config.mjs": "tailwind",
  "tailwind.config.ts": "tailwind",
  "tsconfig.json": "typescript",
  "vite.config.js": "vite",
  "vite.config.mjs": "vite",
  "vite.config.ts": "vite",
  "webpack.config.js": "webpack",
  "webpack.config.ts": "webpack",
  yarn: "npm",
};

const EXTENSION_TOKEN_BY_NAME: Record<string, CodexFileTreeIconToken> = {
  astro: "astro",
  bash: "bash",
  bmp: "image",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "c",
  css: "css",
  csv: "table",
  cts: "typescript",
  db: "database",
  gif: "image",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ico: "image",
  jpeg: "image",
  jpg: "image",
  js: "javascript",
  json: "json",
  jsx: "react",
  lock: "text",
  mcp: "mcp",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  mts: "typescript",
  png: "image",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sass: "sass",
  scss: "sass",
  sh: "bash",
  sqlite: "database",
  sql: "database",
  svg: "svg",
  swift: "swift",
  svelte: "svelte",
  tf: "terraform",
  toml: "text",
  ts: "typescript",
  tsv: "table",
  tsx: "react",
  txt: "text",
  vue: "vue",
  wasm: "wasm",
  webp: "image",
  yaml: "yml",
  yml: "yml",
  zig: "zig",
  zip: "zip",
} satisfies Record<string, CodexFileTreeIconToken>;

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function extensionForBasename(name: string): string {
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return "";
  return name.slice(index + 1);
}

function resolveByConfigPrefix(lowerName: string): CodexFileTreeIconToken | null {
  if (lowerName.startsWith("astro.config.")) return "astro";
  if (lowerName.startsWith("babel.config.")) return "babel";
  if (lowerName.startsWith("biome.")) return "biome";
  if (lowerName.startsWith("browserslist")) return "browserslist";
  if (lowerName.startsWith("mcp.")) return "mcp";
  if (lowerName.startsWith("svgo.config.")) return "svgo";
  return null;
}

export function resolveCodexFileTreeIconToken(path: string): CodexFileTreeIconToken {
  const name = basename(path).toLowerCase();
  const exactToken = EXACT_FILE_TOKEN_BY_NAME[name];
  if (exactToken) return exactToken;

  const configToken = resolveByConfigPrefix(name);
  if (configToken) return configToken;

  const extension = extensionForBasename(name);
  if (!extension) return "default";
  return EXTENSION_TOKEN_BY_NAME[extension] ?? "default";
}

export function resolveCodexFileTreeIcon(path: string): CodexFileTreeIconDescriptor {
  const token = resolveCodexFileTreeIconToken(path);
  return {
    token,
    name: `file-tree-builtin-${token}`,
    viewBox: "0 0 16 16",
  };
}

export function getCodexFileTreeIconColor(token: CodexFileTreeIconToken | null | undefined): string {
  if (!token) return "var(--color-token-text-tertiary)";
  const colorName = CODEX_FILE_TREE_ICON_COLOR_BY_TOKEN[token];
  if (!colorName) return "var(--color-token-text-tertiary)";

  const fallback = CODEX_FILE_TREE_ICON_COLOR_FALLBACKS[colorName];
  return `var(--trees-file-icon-color-${token}, var(--trees-file-icon-color, ${fallback}))`;
}

export const codexFileTreeIconTestInternals = {
  CODEX_FILE_TREE_ICON_COLOR_FALLBACKS,
  CODEX_FILE_TREE_ICON_COLOR_BY_TOKEN,
};
