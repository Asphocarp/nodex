export interface RestorePackagedBrowserRuntimeClosureOptions {
  readonly packagedBrowserRoot: string;
  readonly sourceBrowserRoot: string;
}

export interface ElectronBuilderAfterPackContext {
  readonly appOutDir: string;
  readonly electronPlatformName: string;
  readonly packager: {
    readonly appInfo: {
      readonly productFilename: string;
    };
    readonly projectDir: string;
  };
}

export function restorePackagedBrowserRuntimeClosure(
  options: RestorePackagedBrowserRuntimeClosureOptions,
): number;

export default function restorePackagedRuntimeClosure(
  context: ElectronBuilderAfterPackContext,
): Promise<void>;
