import { randomUUID } from "node:crypto";
import type { BrowserRuntimeBackend } from "../../shared/browser-runtime-metadata";
import type { BrowserSidebarService } from "../browser-sidebar-service";
import {
  BrowserUseIabApi,
  type BrowserUseCdpEvent,
  type BrowserUseIabApiOptions,
  type BrowserUseRoute,
} from "./browser-use-iab-api";
import {
  BrowserUseNativePipeServer,
  type BrowserUseNativePipeServerEvents,
  type BrowserUseNativePipeRequestHandler,
} from "./browser-use-native-pipe-server";
import type { BrowserUseSocketPeerAuthorizer } from "./browser-use-peer-authorizer";
import type { BrowserUsePolicyReader } from "./browser-use-policy-store";

const MAX_DEBUG_EVENTS = 200;

export interface BrowserUseRouteCapture extends BrowserUseRoute {
  disposeAfterSessionActivity?: boolean;
}

export interface BrowserUseTurnLifecycleInput {
  sessionId: string;
  turnId: string;
}

export interface BrowserUseCursorArrivalInput {
  browserConversationId: string;
  browserViewScopeId: string;
  browserTabId: string;
  moveSequence: number;
  ownerWebContentsId: number;
}

export interface BrowserUseSessionRegistryDebugEvent {
  details?: Record<string, string | number | boolean | null>;
  kind: string;
  sequence: number;
  sessionId: string | null;
  timestampMs: number;
}

export interface BrowserUseSessionRegistrySnapshot {
  events: BrowserUseSessionRegistryDebugEvent[];
  sessions: Array<{
    browserConversationId: string;
    browserViewScopeId: string;
    currentTurnId: string | null;
    disposeAfterSessionActivity: boolean;
    ownerWebContentsId: number;
    pipeReady: boolean;
    sessionId: string;
  }>;
}

interface BrowserUseNativePipeServerPort {
  readonly pipePath: string;
  broadcast(method: string, params?: unknown): void;
  close(): Promise<void>;
  start(): Promise<void>;
}

interface BrowserUseIabApiPort {
  addCdpEventListener(listener: (event: BrowserUseCdpEvent) => void): () => void;
  dispatch(method: string, params: unknown): Promise<unknown>;
  dispose(): Promise<void>;
  hasActiveControl(): boolean;
  notifyCursorArrived(moveSequence: number): void;
  turnEnded(params: unknown): Promise<void>;
}

interface BrowserUseBackendState {
  api: BrowserUseIabApiPort;
  completedTurnIds: Set<string>;
  currentTurnId: string | null;
  disposeAfterSessionActivity: boolean;
  disposeCdpListener: () => void;
  route: BrowserUseRoute;
  server: BrowserUseNativePipeServerPort;
  turnEndQueue: Promise<void>;
}

export interface BrowserUseSessionRegistryOptions {
  appSessionId?: string;
  appVersion: string;
  browserService: BrowserSidebarService;
  buildFlavor: string;
  enabled: boolean;
  grantDownload?: BrowserUseIabApiOptions["grantDownload"];
  nativePipeEvents?: BrowserUseNativePipeServerEvents;
  policyStore?: BrowserUsePolicyReader;
  socketPeerAuthorizer: BrowserUseSocketPeerAuthorizer;
  createApi?: (route: BrowserUseRoute) => BrowserUseIabApiPort;
  createServer?: (handler: BrowserUseNativePipeRequestHandler) => BrowserUseNativePipeServerPort;
}

export class BrowserUseSessionRegistry {
  private readonly appSessionId: string;
  private readonly appVersion: string;
  private readonly browserService: BrowserSidebarService;
  private readonly buildFlavor: string;
  private readonly createApi: (route: BrowserUseRoute) => BrowserUseIabApiPort;
  private readonly createServer: (
    handler: BrowserUseNativePipeRequestHandler,
  ) => BrowserUseNativePipeServerPort;
  private readonly debugEvents: BrowserUseSessionRegistryDebugEvent[] = [];
  private readonly enabled: boolean;
  private readonly sessions = new Map<string, BrowserUseBackendState>();
  private readonly starting = new Map<string, Promise<BrowserUseBackendState>>();
  private nextDebugSequence = 1;
  private disposed = false;

  constructor(options: BrowserUseSessionRegistryOptions) {
    this.appSessionId = options.appSessionId ?? randomUUID();
    this.appVersion = options.appVersion;
    this.browserService = options.browserService;
    this.buildFlavor = options.buildFlavor;
    this.enabled = options.enabled;
    this.createApi =
      options.createApi ??
      ((route) =>
        new BrowserUseIabApi({
          appSessionId: this.appSessionId,
          appVersion: this.appVersion,
          browserService: this.browserService,
          buildFlavor: this.buildFlavor,
          grantDownload: options.grantDownload,
          policyStore: options.policyStore,
          route,
        }));
    this.createServer =
      options.createServer ??
      ((handler) =>
        new BrowserUseNativePipeServer({
          events: options.nativePipeEvents,
          handler,
          socketPeerAuthorizer: options.socketPeerAuthorizer,
        }));
  }

  availableBackends(): readonly BrowserRuntimeBackend[] {
    return this.enabled && !this.disposed ? ["iab"] : [];
  }

  async captureRoute(
    input: BrowserUseRouteCapture,
  ): Promise<{ pipePath: string; route: BrowserUseRoute }> {
    if (!this.enabled) throw new Error("Browser Use IAB backend is unavailable");
    if (this.disposed) throw new Error("Browser Use session registry is disposed");
    const route: BrowserUseRoute = {
      browserConversationId: input.browserConversationId,
      browserViewScopeId: input.browserViewScopeId,
      codexSessionId: input.codexSessionId,
      ownerWebContentsId: input.ownerWebContentsId,
      projectId: input.projectId,
    };
    if (route.codexSessionId !== route.browserConversationId) {
      await this.releaseMatchingProvisionalRoute(route);
    }
    const existing = this.sessions.get(input.codexSessionId);
    if (existing) {
      if (
        existing.route.ownerWebContentsId !== input.ownerWebContentsId ||
        existing.route.browserViewScopeId !== input.browserViewScopeId ||
        existing.route.browserConversationId !== input.browserConversationId
      ) {
        if (existing.api.hasActiveControl()) {
          this.record("route-rebind-rejected", input.codexSessionId, {
            ownerWebContentsId: input.ownerWebContentsId,
          });
          throw new Error("Browser Use route has live controlled pages");
        }
        await this.releaseSession(input.codexSessionId);
      } else {
        existing.disposeAfterSessionActivity =
          existing.disposeAfterSessionActivity || input.disposeAfterSessionActivity === true;
        return { pipePath: existing.server.pipePath, route: existing.route };
      }
    }

    const state = await this.ensureBackend(route, input.disposeAfterSessionActivity === true);
    this.record("route-captured", input.codexSessionId, {
      ownerWebContentsId: input.ownerWebContentsId,
    });
    return {
      pipePath: state.server.pipePath,
      route: state.route,
    };
  }

  turnStarted(input: BrowserUseTurnLifecycleInput): void {
    const state = this.sessions.get(input.sessionId);
    if (!state) return;
    state.currentTurnId = input.turnId;
    state.completedTurnIds.delete(input.turnId);
    this.record("turn-started", input.sessionId, { turnId: input.turnId });
  }

  turnEnded(input: BrowserUseTurnLifecycleInput): Promise<void> {
    const state = this.sessions.get(input.sessionId);
    if (!state) return Promise.resolve();
    const operation = state.turnEndQueue
      .catch(() => undefined)
      .then(async () => {
        if (state.completedTurnIds.has(input.turnId)) return;
        if (state.currentTurnId !== null && state.currentTurnId !== input.turnId) {
          this.record("stale-turn-end-ignored", input.sessionId, {
            currentTurnId: state.currentTurnId,
            turnId: input.turnId,
          });
          return;
        }
        await state.api.turnEnded({
          session_id: input.sessionId,
          turn_id: input.turnId,
        });
        state.completedTurnIds.add(input.turnId);
        while (state.completedTurnIds.size > 64) {
          const oldest = state.completedTurnIds.values().next().value;
          if (oldest === undefined) break;
          state.completedTurnIds.delete(oldest);
        }
        if (state.currentTurnId === input.turnId) state.currentTurnId = null;
        this.record("turn-ended", input.sessionId, { turnId: input.turnId });
        if (state.disposeAfterSessionActivity) {
          await this.releaseSession(input.sessionId);
        }
      });
    state.turnEndQueue = operation;
    return operation;
  }

  notifyCursorArrived(input: BrowserUseCursorArrivalInput): void {
    const state = [...this.sessions.values()].find(
      (candidate) =>
        candidate.route.browserConversationId === input.browserConversationId &&
        candidate.route.browserViewScopeId === input.browserViewScopeId &&
        candidate.route.ownerWebContentsId === input.ownerWebContentsId,
    );
    if (!state) return;
    state.api.notifyCursorArrived(input.moveSequence);
    this.record("cursor-arrived", state.route.codexSessionId, {
      moveSequence: input.moveSequence,
    });
  }

  async releaseOwner(ownerWebContentsId: number): Promise<void> {
    const sessionIds = [...this.sessions.entries()]
      .filter(([, state]) => state.route.ownerWebContentsId === ownerWebContentsId)
      .map(([sessionId]) => sessionId);
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        await this.releaseSession(sessionId);
      }),
    );
  }

  async releaseSession(sessionId: string): Promise<void> {
    const starting = this.starting.get(sessionId);
    if (starting) await starting.catch(() => undefined);
    const state = this.sessions.get(sessionId);
    if (!state) return;
    this.sessions.delete(sessionId);
    state.disposeCdpListener();
    await state.api.dispose();
    await state.server.close();
    this.record("session-released", sessionId);
  }

  getDebugSnapshot(): BrowserUseSessionRegistrySnapshot {
    return {
      events: this.debugEvents.map((event) => ({
        ...event,
        ...(event.details ? { details: { ...event.details } } : {}),
      })),
      sessions: [...this.sessions.entries()].map(([sessionId, state]) => ({
        browserConversationId: state.route.browserConversationId,
        browserViewScopeId: state.route.browserViewScopeId,
        currentTurnId: state.currentTurnId,
        disposeAfterSessionActivity: state.disposeAfterSessionActivity,
        ownerWebContentsId: state.route.ownerWebContentsId,
        pipeReady: true,
        sessionId,
      })),
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const sessionIds = [...new Set([...this.sessions.keys(), ...this.starting.keys()])];
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        await this.releaseSession(sessionId);
      }),
    );
  }

  private ensureBackend(
    route: BrowserUseRoute,
    disposeAfterSessionActivity: boolean,
  ): Promise<BrowserUseBackendState> {
    const active = this.sessions.get(route.codexSessionId);
    if (active) return Promise.resolve(active);
    const pending = this.starting.get(route.codexSessionId);
    if (pending) return pending;

    const operation = (async () => {
      const api = this.createApi(route);
      const server = this.createServer(
        async (request) => await api.dispatch(request.method, request.params),
      );
      let disposeCdpListener: () => void = () => undefined;
      try {
        disposeCdpListener = api.addCdpEventListener((event) => {
          server.broadcast("onCDPEvent", event);
        });
        await server.start();
        const state: BrowserUseBackendState = {
          api,
          completedTurnIds: new Set(),
          currentTurnId: null,
          disposeAfterSessionActivity,
          disposeCdpListener,
          route,
          server,
          turnEndQueue: Promise.resolve(),
        };
        this.sessions.set(route.codexSessionId, state);
        this.record("backend-ready", route.codexSessionId);
        return state;
      } catch (error) {
        disposeCdpListener();
        await api.dispose().catch(() => undefined);
        await server.close().catch(() => undefined);
        this.record("backend-start-failed", route.codexSessionId);
        throw error;
      } finally {
        this.starting.delete(route.codexSessionId);
      }
    })();
    this.starting.set(route.codexSessionId, operation);
    return operation;
  }

  private async releaseMatchingProvisionalRoute(route: BrowserUseRoute): Promise<void> {
    const provisionalSessionId = route.browserConversationId;
    const pending = this.starting.get(provisionalSessionId);
    if (pending) await pending.catch(() => undefined);
    const provisional = this.sessions.get(provisionalSessionId);
    if (!provisional) return;
    if (
      provisional.route.browserConversationId !== route.browserConversationId ||
      provisional.route.browserViewScopeId !== route.browserViewScopeId ||
      provisional.route.ownerWebContentsId !== route.ownerWebContentsId
    )
      return;

    await this.releaseSession(provisionalSessionId);
    this.record("provisional-route-rebound", route.codexSessionId, {
      provisionalSessionId,
    });
  }

  private record(
    kind: string,
    sessionId: string | null,
    details?: Record<string, string | number | boolean | null>,
  ): void {
    this.debugEvents.push({
      ...(details ? { details } : {}),
      kind,
      sequence: this.nextDebugSequence++,
      sessionId,
      timestampMs: Date.now(),
    });
    if (this.debugEvents.length > MAX_DEBUG_EVENTS) this.debugEvents.shift();
  }
}
