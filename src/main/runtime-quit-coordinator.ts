export interface FlushableRuntimeWindow {
  close(): void;
  isDestroyed(): boolean;
  once(event: "closed", listener: () => void): unknown;
}

export async function closeWindowsBeforeRuntimeShutdown(
  windows: readonly FlushableRuntimeWindow[],
): Promise<void> {
  await Promise.all(
    windows.map(async (window) => {
      if (window.isDestroyed()) return;
      await new Promise<void>((resolve) => {
        window.once("closed", resolve);
        window.close();
      });
    }),
  );
}
