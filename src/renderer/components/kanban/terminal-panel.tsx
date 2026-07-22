import { useTerminal } from "@/lib/use-terminal";
import type { ReactNode } from "react";

interface TerminalPanelProps {
  terminalId: string;
  cwd: string;
  conversationId?: string | null;
  projectSessionId?: string | null;
  onNewTerminalTab?: () => void;
}

function normalizeCwd(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim();
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : null;
}

export function TerminalPanel({
  terminalId,
  cwd,
  conversationId,
  projectSessionId,
  onNewTerminalTab,
}: TerminalPanelProps) {
  const normalizedCwd = normalizeCwd(cwd);
  if (!normalizedCwd) {
    return (
      <TerminalSurface terminalId={terminalId}>
        <div className="terminal-fallback-surface flex h-full w-full items-center justify-center text-sm text-token-text-secondary">
          Terminal workspace is unavailable
        </div>
      </TerminalSurface>
    );
  }

  return (
    <ConnectedTerminalPanel
      terminalId={terminalId}
      cwd={normalizedCwd}
      conversationId={conversationId}
      projectSessionId={projectSessionId}
      onNewTerminalTab={onNewTerminalTab}
    />
  );
}

function ConnectedTerminalPanel({
  terminalId,
  cwd,
  conversationId,
  projectSessionId,
  onNewTerminalTab,
}: TerminalPanelProps) {
  const { containerRef, isUnavailable, error, reconnect } = useTerminal({
    terminalId,
    visible: true,
    cwd,
    conversationId,
    projectSessionId,
    onNewTerminalTab,
  });

  return (
    <TerminalSurface terminalId={terminalId}>
      <div className="h-full w-full pb-3 pl-4 tracking-normal">
        {isUnavailable ? (
          <div className="terminal-fallback-surface flex h-full w-full items-center justify-center text-sm text-token-text-secondary">
            Terminal requires the Electron desktop app
          </div>
        ) : (
          <div className="relative h-full w-full overflow-hidden">
            <div ref={containerRef} className="h-full w-full overflow-hidden" />
            {error ? (
              <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg bg-token-foreground/10 px-3 py-2 text-sm text-token-text-primary backdrop-blur">
                <span className="min-w-0 flex-1 truncate">{error}</span>
                <button
                  type="button"
                  className="shrink-0 rounded-md bg-token-foreground/10 px-2 py-1 text-xs text-token-text-primary hover:bg-token-foreground/15"
                  onClick={reconnect}
                >
                  Restart
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </TerminalSurface>
  );
}

function TerminalSurface({
  terminalId,
  children,
}: {
  terminalId: string;
  children: ReactNode;
}) {
  return (
    <div
      id={`terminal-panel-${terminalId}`}
      data-codex-terminal="true"
      data-codex-xterm="true"
      className="app-theme relative flex h-full w-full flex-col"
      style={{
        backgroundColor: "var(--vscode-terminal-background)",
        color: "var(--vscode-terminal-foreground)",
      }}
    >
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
