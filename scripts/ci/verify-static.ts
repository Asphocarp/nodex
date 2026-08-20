import { execFileSync } from "node:child_process";

interface StaticCheck {
  readonly command: readonly string[];
  readonly name: string;
}

export const STATIC_CHECKS: readonly StaticCheck[] = [
  { command: ["run", "typecheck"], name: "typecheck" },
  { command: ["run", "lint"], name: "lint" },
  { command: ["run", "semantic-theme:verify"], name: "semantic theme" },
  { command: ["run", "verify:icons"], name: "icon boundaries" },
  { command: ["run", "ci:workflow-contracts"], name: "workflow contracts" },
  { command: ["run", "ci:stress-workflow-contracts"], name: "stress workflow ownership" },
  { command: ["run", "ci:verify-ignored-rust-tests"], name: "ignored Rust test tiers" },
  { command: ["run", "core:protocol:verify"], name: "protocol contracts" },
  { command: ["run", "core:module-boundaries"], name: "module boundaries" },
  { command: ["run", "version-surfaces:audit"], name: "version surfaces" },
  { command: ["run", "build-resources:verify"], name: "generated build resources and notices/legal" },
  { command: ["run", "build:landing"], name: "landing build" },
];

const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

for (const check of STATIC_CHECKS) {
  process.stdout.write(`\n[static] ${check.name}\n`);
  execFileSync(pnpmExecutable, check.command, { cwd: process.cwd(), stdio: "inherit" });
}
