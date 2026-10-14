import { deviceIdFor, type TIdentity } from "@agentdeck/crypto";
import {
  FirebaseAuth,
  TokenSource,
  type TFirebaseConfig,
  type TFirebaseSession,
} from "@agentdeck/firebase-rest";
import {
  AgentdeckError,
  type TAccountStatus,
  type TDevice,
  type TPreviewOpenResult,
  type TRelayConfig,
} from "@agentdeck/protocol";
import type { ILogger } from "@agentdeck/shared";
import { z } from "zod";

import type { EventBus } from "#src/infra/bus/index.js";
import { SealedFile, type TVault } from "#src/infra/keystore/index.js";
import { RelayApi, RelayHttpError, RelayLink } from "#src/infra/relay/index.js";
import type { Router } from "#src/infra/rpc/index.js";
import { RelayTransport, type IPreviewPorts, type IRelayPeers } from "#src/infra/transport/index.js";
import type { DevicesService } from "#src/modules/devices/index.js";

export type TRelayStatus = {
  configured: boolean;
  url: string | null;
  connected: boolean;
  deviceId: string | null;
};

const linkedSchema = z.object({
  relayUrl: z.string(),
  deviceToken: z.string(),
  email: z.string().nullable(),
  /** The Firebase session, when the relay's project uses Firebase (absent with dev sign-in). */
  firebase: z
    .object({ uid: z.string(), email: z.string().nullable(), refreshToken: z.string() })
    .nullable()
    .optional(),
});
type TLinked = z.infer<typeof linkedSchema>;

/** What the cloud history sync needs: the project, and ID tokens for the signed-in user. */
export type TCloudAccess = { config: TFirebaseConfig; tokens: TokenSource; uid: string; hostId: string };
const REFRESH_MS = 5 * 60 * 1000;
/** On-demand refreshes (an unknown device knocking) at most this often. */
const ON_DEMAND_MS = 2000;

const isUnauthorized = (e: unknown): boolean => e instanceof RelayHttpError && e.status === 401;
const message = (e: unknown): string => (e instanceof Error ? e.message : "error");

/**
 * Everything that reaches beyond this machine: signing this host in to an account, the relay socket,
 * and encrypted sessions with the account's consumers. The account's device list on the relay is
 * the trust root: it is cached in `devices` and refreshed periodically, on presence, and when an
 * unknown device knocks.
 */
export class Remote {
  private api: RelayApi | null = null;
  private stored: SealedFile<typeof linkedSchema> | null = null;
  private ctx: { identity: TIdentity; bus: EventBus; router: Router; previews: IPreviewPorts } | null = null;
  private deviceId: string | null = null;
  private linked: TLinked | null = null;
  private pendingEmail: string | null = null;
  private configCache: Promise<TRelayConfig> | null = null;
  private tokens: TokenSource | null = null;
  private link: RelayLink | null = null;
  private transport: RelayTransport | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;
  private lastRefresh = 0;

  constructor(
    private readonly relayUrl: string | null,
    readonly hostName: string,
    private readonly appUrl: string,
    private readonly tokenFile: string,
    private readonly devices: DevicesService,
    private readonly log: ILogger,
  ) {}

  start(identity: TIdentity, vault: TVault, bus: EventBus, router: Router, previews: IPreviewPorts): void {
    this.deviceId = deviceIdFor(identity.signPub);
    this.ctx = { identity, bus, router, previews };
    if (this.relayUrl === null) return;
    this.api = new RelayApi(this.relayUrl, identity, this.hostName);
    this.stored = new SealedFile(this.tokenFile, vault, linkedSchema);
    const saved = this.stored.read();
    if (saved?.relayUrl === this.relayUrl) this.connect(saved);
  }

  private readonly peers: IRelayPeers = {
    signPubOf: async (id) => {
      const known = this.devices.signPubOf(id);
      if (known) return known;
      await this.refresh(true);
      return this.devices.signPubOf(id);
    },
    seen: (id) => {
      this.devices.seen(id);
    },
    onPresence: (id, online) => {
      if (online && !this.devices.known(id)) void this.refresh(true);
    },
  };

  private connect(linked: TLinked): void {
    const { api, ctx, deviceId, relayUrl } = this;
    if (!api || !ctx || deviceId === null || relayUrl === null) return;
    this.linked = linked;
    const transport = new RelayTransport(
      ctx.identity,
      deviceId,
      { send: (text) => this.link?.send(text) ?? false },
      ctx.bus,
      ctx.router,
      this.peers,
      this.log,
      ctx.previews,
    );
    this.transport = transport;
    this.link = new RelayLink({
      url: relayUrl,
      token: linked.deviceToken,
      onRemoved: () => {
        this.unlink();
      },
      stillValid: async () => {
        try {
          await api.me(linked.deviceToken);
          return true;
        } catch (e) {
          if (isUnauthorized(e)) return false;
          throw e;
        }
      },
      onText: (text) => {
        transport.onText(text);
      },
      onState: (connected) => {
        this.log.info({ connected }, "relay link");
        if (connected) void this.refresh(false);
        else transport.linkDown();
      },
      log: this.log,
    });
    this.link.start();
    this.refreshTimer = setInterval(() => {
      void this.refresh(false);
    }, REFRESH_MS);
    this.refreshTimer.unref();
  }

  /** Re-reads the account's devices; drops sessions of devices that left it. */
  private refresh(onDemand: boolean): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const since = Date.now() - this.lastRefresh;
    if (onDemand && since < ON_DEMAND_MS) {
      // Too soon to ask the relay again: ask once the window has passed, not never (a device that
      // registered just after the last refresh would otherwise be refused until the next one).
      return new Promise<void>((r) => setTimeout(r, ON_DEMAND_MS - since)).then(() => this.refresh(true));
    }
    const { api, linked } = this;
    if (!api || !linked) return Promise.resolve();
    this.lastRefresh = Date.now();
    this.refreshing = (async () => {
      try {
        const gone = this.devices.replace(this.deviceId, await api.devices(linked.deviceToken));
        for (const id of gone) this.transport?.dropPeer(id);
      } catch (e) {
        if (isUnauthorized(e)) this.unlink();
        else this.log.warn({ err: message(e) }, "could not refresh the account's devices");
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Forgets the account: closes the socket and sessions and deletes the sealed token. */
  private unlink(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.link?.stop();
    this.link = null;
    this.transport?.close();
    this.transport = null;
    this.linked = null;
    this.tokens = null;
    this.stored?.clear();
    this.devices.replace(this.deviceId, []);
  }

  private needApi(): RelayApi {
    if (!this.api) {
      throw new AgentdeckError("BAD_STATE", "No relay is configured; run `agentdeck relay set <url>` first");
    }
    return this.api;
  }

  /** The relay's client configuration, fetched once per daemon run. */
  private async relayConfig(): Promise<TRelayConfig> {
    this.configCache ??= this.needApi().config();
    try {
      return await this.configCache;
    } catch (e) {
      this.configCache = null;
      throw e;
    }
  }

  private notSignedInYet(): void {
    if (this.linked) throw new AgentdeckError("BAD_STATE", "Already signed in; run `agentdeck logout` first");
  }

  /** Emails a Firebase sign-in link; `completeSignIn` finishes with the link from the email. */
  async signIn(email: string): Promise<void> {
    this.notSignedInYet();
    const { firebase } = await this.relayConfig();
    if (!firebase) {
      throw new AgentdeckError(
        "BAD_STATE",
        "This relay has no Firebase project; use `agentdeck login --dev <uid>`",
      );
    }
    await new FirebaseAuth(firebase).sendEmailLink(email, `${this.appUrl.replace(/\/$/, "")}/sign-in`);
    this.pendingEmail = email;
  }

  async completeSignIn(link: string): Promise<TAccountStatus> {
    this.notSignedInYet();
    const email = this.pendingEmail;
    if (email === null)
      throw new AgentdeckError("BAD_STATE", "Run `agentdeck login` to get a sign-in link first");
    const { firebase } = await this.relayConfig();
    if (!firebase) throw new AgentdeckError("BAD_STATE", "This relay has no Firebase project");
    const signed = await new FirebaseAuth(firebase).signInWithEmailLink(email, link).catch((e: unknown) => {
      throw new AgentdeckError("UNAUTHORIZED", `Sign-in failed: ${message(e)}`);
    });
    this.pendingEmail = null;
    await this.join(signed.idToken, signed.session.email, signed.session);
    return this.accountStatus();
  }

  /**
   * Dev relays: signs in as `uid`, through the Firebase Auth emulator when the relay uses one
   * (as `<uid>@example.com`, so every device of that user shares the account), else the relay's
   * own dev issuer.
   */
  async signInDev(uid: string): Promise<TAccountStatus> {
    this.notSignedInYet();
    const cfg = await this.relayConfig();
    if (!cfg.devSignIn) throw new AgentdeckError("UNAUTHORIZED", "Dev sign-in is only for dev relays");
    if (cfg.firebase?.emulators?.auth !== undefined) {
      const auth = new FirebaseAuth(cfg.firebase);
      const email = `${uid}@example.com`;
      const signed = await auth.signInWithEmailLink(email, await auth.emulatorSignInLink(email));
      await this.join(signed.idToken, email, signed.session);
    } else {
      await this.join(await this.needApi().devIdToken(uid), `${uid}@example.com`, null);
    }
    return this.accountStatus();
  }

  /** Registers this computer as a host with an ID token, keeps the tokens sealed, connects. */
  private async join(
    idToken: string,
    email: string | null,
    firebase: TFirebaseSession | null,
  ): Promise<void> {
    const relayUrl = this.relayUrl;
    if (relayUrl === null) throw new AgentdeckError("BAD_STATE", "No relay is configured");
    const deviceToken = await this.needApi().register(idToken);
    const linked: TLinked = { relayUrl, deviceToken, email, firebase };
    this.stored?.write(linked);
    this.log.info({ email }, "signed in");
    this.connect(linked);
  }

  /** Firebase access for the cloud history, or null (local only, or dev sign-in without Firebase). */
  async cloudAccess(): Promise<TCloudAccess | null> {
    const linked = this.linked;
    const session = linked?.firebase;
    if (!linked || !session || this.deviceId === null) return null;
    const { firebase } = await this.relayConfig();
    if (!firebase) return null;
    this.tokens ??= new TokenSource(new FirebaseAuth(firebase), session, (rotated) => {
      if (!this.linked) return;
      this.linked = { ...this.linked, firebase: rotated };
      this.stored?.write(this.linked);
    });
    return { config: firebase, tokens: this.tokens, uid: session.uid, hostId: this.deviceId };
  }

  accountStatus(): TAccountStatus {
    if (this.relayUrl === null) return { state: "local" };
    if (this.linked) return { state: "linked", email: this.linked.email };
    if (this.pendingEmail !== null) return { state: "awaitingLink", email: this.pendingEmail };
    return { state: "unlinked" };
  }

  /** Leaves the account: the relay forgets this host, and this host forgets its token. */
  async logout(): Promise<void> {
    this.pendingEmail = null;
    const { api, linked, deviceId } = this;
    if (api && linked && deviceId !== null) {
      try {
        await api.removeDevice(linked.deviceToken, deviceId);
      } catch (e) {
        this.log.warn({ err: message(e) }, "relay did not confirm the logout");
      }
    }
    this.unlink();
  }

  status(): TRelayStatus {
    return {
      configured: this.relayUrl !== null,
      url: this.relayUrl,
      connected: this.link?.connected ?? false,
      deviceId: this.deviceId,
    };
  }

  /** Removes a device from the account. Every host drops it on its next refresh; this one now. */
  async revoke(deviceId: string): Promise<TDevice> {
    const api = this.needApi();
    if (!this.linked) throw new AgentdeckError("BAD_STATE", "This host isn't linked to an account");
    if (deviceId === this.deviceId) {
      throw new AgentdeckError("INVALID_ARGS", "To remove this host, run `agentdeck logout`");
    }
    try {
      await api.removeDevice(this.linked.deviceToken, deviceId);
    } catch (e) {
      if (e instanceof RelayHttpError && e.status === 404) {
        throw new AgentdeckError("NOT_FOUND", `No device ${deviceId} on this account`);
      }
      throw e;
    }
    this.transport?.dropPeer(deviceId);
    return this.devices.known(deviceId) ? this.devices.forget(deviceId) : this.removedStub(deviceId);
  }

  /** A preview tunnel (Phase 3c) to a worktree of this host, which only `deviceId` can open. */
  async openPreview(worktreeId: string, deviceId: string): Promise<TPreviewOpenResult> {
    const api = this.needApi();
    if (!this.linked) throw new AgentdeckError("BAD_STATE", "This host isn't signed in to an account");
    try {
      return await api.openPreview(this.linked.deviceToken, worktreeId, deviceId);
    } catch (e) {
      if (e instanceof RelayHttpError && e.status === 404) {
        throw new AgentdeckError("BAD_STATE", "Previews are off on this relay (no PREVIEW_DOMAIN)");
      }
      throw e;
    }
  }

  /** Best effort: an unreachable relay forgets the tunnel when it expires. */
  async closePreview(token: string): Promise<void> {
    const { api, linked } = this;
    if (!api || !linked) return;
    try {
      await api.closePreview(linked.deviceToken, token);
    } catch (e) {
      this.log.warn({ err: message(e) }, "relay did not confirm closing a preview");
    }
  }

  private removedStub(id: string): TDevice {
    return { id, name: id, kind: "phone", pairedAt: 0, lastSeenAt: null, revokedAt: Date.now() };
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.link?.stop();
    this.transport?.close();
  }
}
