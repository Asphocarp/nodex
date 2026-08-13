import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  resolveSubagentAvatarIndex,
  SubagentAvatar,
} from "./subagent-avatar";

function resolveCatalogSeeds(): readonly string[] {
  const seeds = Array.from({ length: 10 }, () => "");

  for (let candidate = 0; candidate < 10_000; candidate += 1) {
    const seed = `storybook-agent-${candidate}`;
    const index = resolveSubagentAvatarIndex(seed);
    if (seeds[index] === "") seeds[index] = seed;
    if (seeds.every(Boolean)) return seeds;
  }

  throw new Error("Unable to resolve a Storybook seed for every subagent avatar");
}

const catalogSeeds = resolveCatalogSeeds();

function SubagentAvatarCatalog() {
  return (
    <main className="min-h-screen bg-token-main-surface-secondary px-8 py-7 text-token-text-primary">
      <header className="mb-6 max-w-2xl">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">
          Subagent avatars
        </h1>
        <p className="mt-1 text-sm leading-5 text-token-text-secondary">
          Ten deterministic, static identities shown at their 14px, 16px, and 24px
          product sizes. Toggle the Storybook appearance to inspect both asset sets.
        </p>
      </header>

      <div className="grid max-w-5xl grid-cols-2 overflow-hidden rounded-xl bg-token-main-surface-primary shadow-[inset_0_0_0_0.5px_var(--border-token)] sm:grid-cols-5">
        {catalogSeeds.map((seed, index) => (
          <div className="min-w-0 px-3 py-3" key={seed}>
            <div className="font-mono text-[10px] font-medium tracking-[0.08em] text-token-description-foreground">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="mt-2 flex h-7 items-center gap-3">
              <SubagentAvatar className="size-3.5" seed={seed} />
              <SubagentAvatar className="size-4" seed={seed} />
              <SubagentAvatar className="size-6" seed={seed} />
            </div>
            <div className="mt-2 truncate font-mono text-[10px] text-token-description-foreground">
              {seed}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

const meta = {
  title: "Conversation/Subagent avatars",
  component: SubagentAvatarCatalog,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SubagentAvatarCatalog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Catalog: Story = {};
