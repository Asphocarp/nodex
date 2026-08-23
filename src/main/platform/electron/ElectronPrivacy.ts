import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { systemPreferences } from "electron";

export class ElectronPrivacy extends Context.Service<
  ElectronPrivacy,
  { readonly systemPreferences: typeof systemPreferences }
>()("nodex/main/platform/electron/ElectronPrivacy") {}

export const live: Layer.Layer<ElectronPrivacy> = Layer.succeed(
  ElectronPrivacy,
  ElectronPrivacy.of({ systemPreferences }),
);
