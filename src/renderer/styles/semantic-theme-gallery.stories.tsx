import type { Meta, StoryObj } from "@storybook/react-vite";

const textRoles = [
  ["Information / active", "text-info"],
  ["Danger / failure", "text-danger"],
  ["Tertiary / pending", "text-tertiary"],
  ["Secondary / completed", "semantic-text-secondary"],
] as const;

function SemanticThemeGallery({ scheme }: { scheme: "light" | "dark" }) {
  return (
    <main
      className={`${scheme === "dark" ? "dark electron-dark" : "electron-light"} min-h-screen bg-token-main-surface-primary p-8 text-token-foreground`}
      data-codex-window-type="electron"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <header>
          <h1 className="heading-lg">Semantic theme roles</h1>
          <p className="mt-1 text-size-chat text-tertiary">
            Shared task status, hierarchy, border, and progress roles.
          </p>
        </header>
        <section className="flex flex-col gap-3" aria-label="Text roles">
          {textRoles.map(([label, className]) => (
            <div key={label} className="grid grid-cols-[12rem_1fr] items-center gap-4">
              <code className="text-size-code-sm text-tertiary">{className}</code>
              <span className={className}>{label}</span>
            </div>
          ))}
        </section>
        <section
          className="rounded-xl border-[0.5px] border-default p-4"
          aria-label="Activity composition"
        >
          <div className="flex items-center gap-2 text-info">
            <span aria-hidden="true" className="size-2 rounded-full bg-text-info" />
            <span>Preparing workspace</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-text/10">
            <div className="h-full w-2/3 rounded-full bg-text-info" />
          </div>
          <div className="semantic-text-secondary mt-2 text-end text-size-chat">67%</div>
        </section>
        <section className="grid grid-cols-2 gap-4" aria-label="Foundation contract">
          <div className="rounded-lg border-[0.5px] border-default p-4">
            <code className="text-size-code-sm text-tertiary">rounded-lg</code>
          </div>
          <div className="app-shell-left-panel relative rounded-2xl p-4">
            <span className="loading-shimmer-pure-text">Preparing workspace</span>
          </div>
        </section>
      </div>
    </main>
  );
}

const meta = {
  title: "Foundations/Semantic theme",
  component: SemanticThemeGallery,
  parameters: { layout: "fullscreen" },
  args: { scheme: "light" },
  argTypes: { scheme: { control: "inline-radio", options: ["light", "dark"] } },
} satisfies Meta<typeof SemanticThemeGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};

export const Dark: Story = { args: { scheme: "dark" } };
