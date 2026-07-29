import { randomUUID } from "node:crypto";
import type {
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
  id: number;
  getURL(): string;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

export interface BrowserCredentialServiceOptions {
  vault: BrowserCredentialVault;
  resolveGuest(identity: BrowserSidebarTabIdentity): BrowserCredentialGuest | null;
  resolveGuestIdentity(guestWebContentsId: number): BrowserSidebarTabIdentity | null;
  resolveGuestOwner(guestWebContentsId: number): number | null;
  now?: () => number;
}

interface PendingCredentialCandidate {
  candidateId: string;
  ownerWebContentsId: number;
  identity: BrowserSidebarTabIdentity;
  input: SaveBrowserCredentialInput;
  expiresAt: number;
}

export class BrowserCredentialService {
  private readonly vault: BrowserCredentialVault;
  private readonly resolveGuest: BrowserCredentialServiceOptions["resolveGuest"];
  private readonly resolveGuestIdentity:
    BrowserCredentialServiceOptions["resolveGuestIdentity"];
  private readonly resolveGuestOwner:
    BrowserCredentialServiceOptions["resolveGuestOwner"];
  private readonly now: () => number;
  private readonly candidates = new Map<string, PendingCredentialCandidate>();

  constructor(options: BrowserCredentialServiceOptions) {
    this.vault = options.vault;
    this.resolveGuest = options.resolveGuest;
    this.resolveGuestIdentity = options.resolveGuestIdentity;
    this.resolveGuestOwner = options.resolveGuestOwner;
    this.now = options.now ?? Date.now;
  }

  capability() {
    return this.vault.capability();
  }

  async listForTab(
    input: BrowserCredentialListInput,
  ): Promise<BrowserCredentialSummary[]> {
    const origin = this.readCurrentOrigin(input);
    if (!origin) return [];
    return await this.vault.listForOrigin(origin);
  }

  async listAll(): Promise<BrowserCredentialSummary[]> {
    return await this.vault.list();
  }

  async listContactInfo(): Promise<BrowserContactInfo[]> {
    return await this.vault.listContactInfo();
  }

  async saveContactInfo(
    input: BrowserContactInfoUpsertInput,
  ): Promise<BrowserContactInfo> {
    return await this.vault.saveContactInfo(input);
  }

  async removeContactInfo(id: string): Promise<BrowserCredentialActionResult> {
    try {
      await this.vault.removeContactInfo(id);
      return { ok: true };
    } catch (error) {
      return actionFailure(error);
    }
  }

  async fillContactInfo(
    input: BrowserContactInfoFillInput,
  ): Promise<BrowserCredentialActionResult> {
    try {
      const guest = this.requireGuest(input);
      const contactInfo = await this.vault.getContactInfo(input.contactInfoId);
      if (!contactInfo) {
        return {
          ok: false,
          message: "This contact info is no longer available",
        };
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
    } catch (error) {
      return actionFailure(error);
    }
  }

  async fill(input: BrowserCredentialFillInput): Promise<BrowserCredentialActionResult> {
    try {
      const guest = this.requireGuest(input);
      const currentOrigin = readHttpOrigin(guest.getURL());
      const credential = await this.vault.get(input.credentialId);
      if (!credential || credential.summary.origin !== currentOrigin) {
        return {
          ok: false,
          message: "This credential does not belong to the current site",
        };
      }
      guest.send("browser-credential-fill", {
        origin: currentOrigin,
        username: credential.summary.username,
        password: credential.password,
        kind: "saved",
      });
      return { ok: true };
    } catch (error) {
      return actionFailure(error);
    }
  }

  async generateAndFill(
    input: BrowserCredentialGenerateInput,
  ): Promise<BrowserCredentialActionResult> {
    try {
      const guest = this.requireGuest(input);
      guest.send("browser-credential-fill", {
        origin: readHttpOrigin(guest.getURL()),
        username: "",
        password: this.vault.generate(input.length),
        kind: "generated",
      });
      return { ok: true };
    } catch (error) {
      return actionFailure(error);
    }
  }

  async remove(id: string): Promise<BrowserCredentialActionResult> {
    try {
      await this.vault.remove(id);
      return { ok: true };
    } catch (error) {
      return actionFailure(error);
    }
  }

  async captureGuestCandidate(
    guestWebContentsId: number,
    input: { username: string; password: string },
  ): Promise<BrowserCredentialSaveCandidate | null> {
    this.pruneCandidates();
    const identity = this.resolveGuestIdentity(guestWebContentsId);
    const ownerWebContentsId = this.resolveGuestOwner(guestWebContentsId);
    const guest = identity ? this.resolveGuest(identity) : null;
    if (
      !identity
      || ownerWebContentsId === null
      || !guest
      || guest.id !== guestWebContentsId
      || guest.isDestroyed()
    ) {
      return null;
    }
    const origin = readHttpOrigin(guest.getURL());
    const candidateInput = {
      origin,
      username: input.username,
      password: input.password,
    };
    if (await this.vault.matches(candidateInput)) return null;

    const candidateId = randomUUID();
    const expiresAt = this.now() + CANDIDATE_TTL_MS;
    const candidate: PendingCredentialCandidate = {
      candidateId,
      ownerWebContentsId,
      identity,
      input: candidateInput,
      expiresAt,
    };
    this.candidates.set(candidateId, candidate);
    this.enforceCandidateLimit();
    return {
      ...identity,
      candidateId,
      origin,
      username: input.username,
      label: input.username.trim() || new URL(origin).hostname,
      expiresAt,
    };
  }

  async actOnCandidate(
    ownerWebContentsId: number,
    input: BrowserCredentialCandidateActionInput,
  ): Promise<BrowserCredentialActionResult> {
    this.pruneCandidates();
    const candidate = this.candidates.get(input.candidateId);
    if (!candidate || candidate.ownerWebContentsId !== ownerWebContentsId) {
      return {
        ok: false,
        message: "The credential save request is no longer available",
      };
    }
    this.candidates.delete(input.candidateId);
    if (input.action === "dismiss") return { ok: true };
    try {
      await this.vault.save(candidate.input);
      return { ok: true };
    } catch (error) {
      return actionFailure(error);
    }
  }

  releaseOwner(ownerWebContentsId: number): void {
    for (const [candidateId, candidate] of this.candidates) {
      if (candidate.ownerWebContentsId === ownerWebContentsId) {
        this.candidates.delete(candidateId);
      }
    }
  }

  private readCurrentOrigin(
    identity: BrowserSidebarTabIdentity,
  ): string | null {
    const guest = this.resolveGuest(identity);
    if (!guest || guest.isDestroyed()) return null;
    try {
      return readHttpOrigin(guest.getURL());
    } catch {
      return null;
    }
  }

  private requireGuest(
    identity: BrowserSidebarTabIdentity,
  ): BrowserCredentialGuest {
    const guest = this.resolveGuest(identity);
    if (!guest || guest.isDestroyed()) {
      throw new Error("Browser page is not attached");
    }
    return guest;
  }

  private pruneCandidates(): void {
    const now = this.now();
    for (const [candidateId, candidate] of this.candidates) {
      if (candidate.expiresAt <= now) this.candidates.delete(candidateId);
    }
  }

  private enforceCandidateLimit(): void {
    if (this.candidates.size <= MAX_PENDING_CANDIDATES) return;
    const oldest = [...this.candidates.values()]
      .sort((left, right) => left.expiresAt - right.expiresAt)[0];
    if (oldest) this.candidates.delete(oldest.candidateId);
  }
}

function readHttpOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The current Browser page has no credential origin");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:")
    || url.username
    || url.password
  ) {
    throw new Error("Browser credentials require an HTTP(S) page");
  }
  return url.origin;
}

function actionFailure(error: unknown): BrowserCredentialActionResult {
  return {
    ok: false,
    message: error instanceof Error
      ? error.message.slice(0, 1_024)
      : "Browser credential action failed",
  };
}
