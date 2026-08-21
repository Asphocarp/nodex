import * as Layer from "effect/Layer";
import type { ConnectOrStartCoreInput } from "../core-client/core-launcher";
import type { MainShutdown } from "../app/MainShutdown";
import { live as authorityLive, CoreAuthority, type CoreAuthorityOptions } from "./CoreAuthority";
import {
  CoreEventDelivery,
  CoreEventHub,
  live as eventHubLive,
  type CoreEventHubOptions,
} from "./CoreEventHub";
import { CoreModules, live as modulesLive } from "./CoreModules";
import { live as transportLive } from "./CoreTransport";
import type { CoreRuntimeError } from "./CoreRuntimeError";

export interface CoreRuntimeOptions {
  readonly launch: ConnectOrStartCoreInput;
  readonly authority?: CoreAuthorityOptions;
  readonly events: CoreEventHubOptions;
}

export const live = (
  options: CoreRuntimeOptions,
): Layer.Layer<
  CoreAuthority | CoreModules | CoreEventHub,
  CoreRuntimeError,
  MainShutdown | CoreEventDelivery
> => {
  const authority = authorityLive(options.authority).pipe(
    Layer.provide(transportLive(options.launch)),
  );
  const consumers = Layer.merge(modulesLive, eventHubLive(options.events)).pipe(
    Layer.provideMerge(authority),
  );
  return consumers;
};
