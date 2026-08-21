import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  makeSiteStatusPolicyRuntime,
  type SiteStatusPolicyRuntime,
} from "../browser-use/site-status-policy-service";
import { ChatGptDesktop } from "../codex-application/ChatGptDesktop";
import { DEFAULT_CHATGPT_BASE_URL } from "../codex/chatgpt-base-url";
import { getLogger } from "../logging/logger";

/** Profile-independent owner of authenticated Browser site capability decisions. */
export class BrowserSiteStatusRuntime extends Context.Service<
  BrowserSiteStatusRuntime,
  SiteStatusPolicyRuntime
>()("nodex/main/host-runtime/BrowserSiteStatusRuntime") {}

export const live: Layer.Layer<BrowserSiteStatusRuntime, never, ChatGptDesktop> = Layer.effect(
  BrowserSiteStatusRuntime,
  Effect.gen(function* () {
    const chatGpt = yield* ChatGptDesktop;
    const runtime = yield* makeSiteStatusPolicyRuntime({
      apiBaseUrl: DEFAULT_CHATGPT_BASE_URL,
      logger: getLogger({ component: "browser-site-status-runtime" }),
      request: chatGpt.request,
    });
    return BrowserSiteStatusRuntime.of(runtime);
  }),
);
