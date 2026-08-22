import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import { randomUUID } from "node:crypto";
import type {
  BrowserCapabilityStatus,
  BrowserContactInfo,
  BrowserContactInfoFillInput,
  BrowserContactInfoUpsertInput,
  BrowserCredentialActionResult,
  BrowserCredentialCandidateActionInput,
  BrowserCredentialFillInput,
  BrowserCredentialGenerateInput,
  BrowserCredentialListInput,
  BrowserCredentialSaveCandidate,
  BrowserCredentialSummary,
} from "../../shared/browser-profile";
import type { BrowserSidebarTabIdentity } from "../../shared/browser-sidebar";
import type {
  BrowserCredentialVault,
  SaveBrowserCredentialInput,
} from "./browser-credential-vault";

const CANDIDATE_TTL_MS = 60_000;
const MAX_PENDING_CANDIDATES = 100;

export interface BrowserCredentialGuest {
  readonly id: number;
  readonly getURL: () => string;
  readonly isDestroyed: () => boolean;
  readonly send: (channel: string, payload: unknown) => void;
}

export interface BrowserCredentialRuntimeOptions {
  readonly vault: BrowserCredentialVault;
  readonly resolveGuest: (identity: BrowserSidebarTabIdentity) => BrowserCredentialGuest | null;
  readonly resolveGuestIdentity: (guestWebContentsId: number) => BrowserSidebarTabIdentity | null;
  readonly resolveGuestOwner: (guestWebContentsId: number) => number | null;
  readonly now?: () => number;
}

interface PendingCredentialCandidate {
  readonly candidateId: string;
  readonly ownerWebContentsId: number;
  readonly identity: BrowserSidebarTabIdentity;
  readonly input: SaveBrowserCredentialInput;
  readonly expiresAt: number;
}

export class BrowserCredentialRuntimeError extends Schema.TaggedError<BrowserCredentialRuntimeError>()(
  "BrowserCredentialRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export interface BrowserCredentialRuntime {
  readonly capability: () => BrowserCapabilityStatus;
  readonly listForTab: (
    input: BrowserCredentialListInput,
  ) => Effect.Effect<readonly BrowserCredentialSummary[], BrowserCredentialRuntimeError>;
  readonly listAll: Effect.Effect<
    readonly BrowserCredentialSummary[],
    BrowserCredentialRuntimeError
  >;
  readonly listContactInfo: Effect.Effect<
    readonly BrowserContactInfo[],
    BrowserCredentialRuntimeError
  >;
  readonly saveContactInfo: (
    input: BrowserContactInfoUpsertInput,
  ) => Effect.Effect<BrowserContactInfo, BrowserCredentialRuntimeError>;
  readonly removeContactInfo: (id: string) => Effect.Effect<BrowserCredentialActionResult>;
  readonly fillContactInfo: (
    input: BrowserContactInfoFillInput,
  ) => Effect.Effect<BrowserCredentialActionResult>;
  readonly fill: (
    input: BrowserCredentialFillInput,
  ) => Effect.Effect<BrowserCredentialActionResult>;
  readonly generateAndFill: (
    input: BrowserCredentialGenerateInput,
  ) => Effect.Effect<BrowserCredentialActionResult>;
  readonly remove: (id: string) => Effect.Effect<BrowserCredentialActionResult>;
  readonly captureGuestCandidate: (
    guestWebContentsId: number,
    input: { readonly username: string; readonly password: string },
  ) => Effect.Effect<BrowserCredentialSaveCandidate | null, BrowserCredentialRuntimeError>;
  readonly actOnCandidate: (
    ownerWebContentsId: number,
    input: BrowserCredentialCandidateActionInput,
  ) => Effect.Effect<BrowserCredentialActionResult>;
  readonly releaseOwner: (ownerWebContentsId: number) => Effect.Effect<void>;
}

const runtimeError = (operation: string, cause: unknown): BrowserCredentialRuntimeError =>
  new BrowserCredentialRuntimeError({ operation, cause });

const actionFailure = (error: unknown): BrowserCredentialActionResult => ({
  ok: false,
  message:
    error instanceof Error ? error.message.slice(0, 1_024) : "Browser credential action failed",
});

const readHttpOrigin = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("The current Browser page has no credential origin");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new TypeError("Browser credentials require an HTTP(S) page");
  }
  return url.origin;
};

const pruneCandidates = (
  candidates: ReadonlyMap<string, PendingCredentialCandidate>,
  now: number,
): ReadonlyMap<string, PendingCredentialCandidate> =>
  new Map([...candidates].filter(([, candidate]) => candidate.expiresAt > now));

const limitCandidates = (
  candidates: ReadonlyMap<string, PendingCredentialCandidate>,
): ReadonlyMap<string, PendingCredentialCandidate> => {
  if (candidates.size <= MAX_PENDING_CANDIDATES) return candidates;
  const newest = [...candidates.values()]
    .sort((left, right) => left.expiresAt - right.expiresAt)
    .slice(-MAX_PENDING_CANDIDATES);
  return new Map(newest.map((candidate) => [candidate.candidateId, candidate] as const));
};

export const makeBrowserCredentialRuntime = (
  options: BrowserCredentialRuntimeOptions,
): Effect.Effect<BrowserCredentialRuntime, never, Scope.Scope> =>
  Effect.gen(function* () {
    const now = options.now ?? Date.now;
    const candidates = yield* Ref.make<ReadonlyMap<string, PendingCredentialCandidate>>(new Map());
    const writes = yield* Semaphore.make(1);
    yield* Effect.addFinalizer(() => Ref.set(candidates, new Map()));

    const attempt = <A>(
      operation: string,
      run: () => A,
    ): Effect.Effect<A, BrowserCredentialRuntimeError> =>
      Effect.try({ try: run, catch: (cause) => runtimeError(operation, cause) });
    const action = (
      operation: string,
      run: () => BrowserCredentialActionResult,
    ): Effect.Effect<BrowserCredentialActionResult> =>
      attempt(operation, run).pipe(
        Effect.catch((error) => Effect.succeed(actionFailure(error.cause))),
      );
    const readCurrentOrigin = (identity: BrowserSidebarTabIdentity): string | null => {
      const guest = options.resolveGuest(identity);
      if (guest === null || guest.isDestroyed()) return null;
      try {
        return readHttpOrigin(guest.getURL());
      } catch {
        return null;
      }
    };
    const requireGuest = (identity: BrowserSidebarTabIdentity): BrowserCredentialGuest => {
      const guest = options.resolveGuest(identity);
      if (guest === null || guest.isDestroyed())
        throw new TypeError("Browser page is not attached");
      return guest;
    };

    return {
      capability: options.vault.capability.bind(options.vault),
      listForTab: (input) => {
        const origin = readCurrentOrigin(input);
        return origin === null
          ? Effect.succeed([])
          : attempt("list-for-origin", () => options.vault.listForOrigin(origin));
      },
      listAll: attempt("list-all", () => options.vault.list()),
      listContactInfo: attempt("list-contact-info", () => options.vault.listContactInfo()),
      saveContactInfo: (input) =>
        writes.withPermits(1)(
          attempt("save-contact-info", () => options.vault.saveContactInfo(input)),
        ),
      removeContactInfo: (id) =>
        writes.withPermits(1)(
          action("remove-contact-info", () => {
            options.vault.removeContactInfo(id);
            return { ok: true };
          }),
        ),
      fillContactInfo: (input) =>
        action("fill-contact-info", () => {
          const guest = requireGuest(input);
          const contactInfo = options.vault.getContactInfo(input.contactInfoId);
          if (contactInfo === null) {
            return { ok: false, message: "This contact info is no longer available" };
          }
          const {
            addressLine1,
            addressLine2,
            city,
            country,
            email,
            fullName,
            phone,
            postalCode,
            region,
          } = contactInfo;
          guest.send("browser-contact-info-fill", {
            origin: readHttpOrigin(guest.getURL()),
            contactInfo: {
              addressLine1,
              addressLine2,
              city,
              country,
              email,
              fullName,
              phone,
              postalCode,
              region,
            },
          });
          return { ok: true };
        }),
      fill: (input) =>
        action("fill", () => {
          const guest = requireGuest(input);
          const currentOrigin = readHttpOrigin(guest.getURL());
          const credential = options.vault.get(input.credentialId);
          if (credential === null || credential.summary.origin !== currentOrigin) {
            return { ok: false, message: "This credential does not belong to the current site" };
          }
          guest.send("browser-credential-fill", {
            origin: currentOrigin,
            username: credential.summary.username,
            password: credential.password,
            kind: "saved",
          });
          return { ok: true };
        }),
      generateAndFill: (input) =>
        action("generate-and-fill", () => {
          const guest = requireGuest(input);
          guest.send("browser-credential-fill", {
            origin: readHttpOrigin(guest.getURL()),
            username: "",
            password: options.vault.generate(input.length),
            kind: "generated",
          });
          return { ok: true };
        }),
      remove: (id) =>
        writes.withPermits(1)(
          action("remove", () => {
            options.vault.remove(id);
            return { ok: true };
          }),
        ),
      captureGuestCandidate: (guestWebContentsId, input) =>
        writes.withPermits(1)(
          Effect.gen(function* () {
            const identity = options.resolveGuestIdentity(guestWebContentsId);
            const ownerWebContentsId = options.resolveGuestOwner(guestWebContentsId);
            const guest = identity === null ? null : options.resolveGuest(identity);
            if (
              identity === null ||
              ownerWebContentsId === null ||
              guest === null ||
              guest.id !== guestWebContentsId ||
              guest.isDestroyed()
            ) {
              return null;
            }
            const origin = yield* attempt("read-candidate-origin", () =>
              readHttpOrigin(guest.getURL()),
            );
            const candidateInput = { origin, username: input.username, password: input.password };
            if (yield* attempt("match-candidate", () => options.vault.matches(candidateInput))) {
              return null;
            }
            const candidateId = randomUUID();
            const expiresAt = now() + CANDIDATE_TTL_MS;
            const candidate = {
              candidateId,
              ownerWebContentsId,
              identity,
              input: candidateInput,
              expiresAt,
            } satisfies PendingCredentialCandidate;
            const current = pruneCandidates(yield* Ref.get(candidates), now());
            yield* Ref.set(
              candidates,
              limitCandidates(new Map(current).set(candidateId, candidate)),
            );
            return {
              ...identity,
              candidateId,
              origin,
              username: input.username,
              label: input.username.trim() || new URL(origin).hostname,
              expiresAt,
            };
          }),
        ),
      actOnCandidate: (ownerWebContentsId, input) =>
        writes.withPermits(1)(
          Effect.gen(function* () {
            const current = pruneCandidates(yield* Ref.get(candidates), now());
            const candidate = current.get(input.candidateId);
            if (candidate === undefined || candidate.ownerWebContentsId !== ownerWebContentsId) {
              yield* Ref.set(candidates, current);
              return { ok: false, message: "The credential save request is no longer available" };
            }
            const next = new Map(current);
            next.delete(input.candidateId);
            yield* Ref.set(candidates, next);
            if (input.action === "dismiss") return { ok: true };
            return yield* action("save-candidate", () => {
              options.vault.save(candidate.input);
              return { ok: true };
            });
          }),
        ),
      releaseOwner: (ownerWebContentsId) =>
        writes.withPermits(1)(
          Ref.update(
            candidates,
            (current) =>
              new Map(
                [...current].filter(
                  ([, candidate]) => candidate.ownerWebContentsId !== ownerWebContentsId,
                ),
              ),
          ),
        ),
    } satisfies BrowserCredentialRuntime;
  });
