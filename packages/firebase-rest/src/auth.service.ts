import { z } from "zod";

import { FirebaseError, type TFirebaseConfig, type TFirebaseSession } from "./firebase.types.js";
import { call, jsonInit } from "./http.utils.js";

const emailLinkResultSchema = z.object({
  idToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.string(),
  localId: z.string(),
  email: z.string().optional(),
});
const refreshResultSchema = z.object({
  id_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.string(),
  user_id: z.string(),
});
const oobCodesSchema = z.object({
  oobCodes: z.array(z.object({ email: z.string(), oobCode: z.string(), requestType: z.string() })),
});

export type TIdToken = { idToken: string; expiresAt: number };

/** The oobCode in an email sign-in link, or in a link nested in its `link`/`continueUrl`. */
export function oobCodeOf(link: string): string | null {
  try {
    const url = new URL(link.trim());
    const code = url.searchParams.get("oobCode");
    if (code !== null) return code;
    for (const inner of ["link", "deep_link_id", "continueUrl"]) {
      const nested = url.searchParams.get(inner);
      if (nested !== null) return oobCodeOf(nested);
    }
    return null;
  } catch {
    return null;
  }
}

/** Firebase Authentication over REST (Identity Toolkit + Secure Token), or its emulator. */
export class FirebaseAuth {
  constructor(private readonly cfg: TFirebaseConfig) {}

  private base(service: "identitytoolkit" | "securetoken"): string {
    const host = this.cfg.emulators?.auth;
    const origin =
      host === undefined ? `https://${service}.googleapis.com` : `http://${host}/${service}.googleapis.com`;
    return `${origin}/v1`;
  }

  /** Step 1 of email-link sign-in: Firebase emails a link that comes back to `continueUrl`. */
  async sendEmailLink(email: string, continueUrl: string): Promise<void> {
    await call(
      `${this.base("identitytoolkit")}/accounts:sendOobCode?key=${this.cfg.apiKey}`,
      jsonInit({ requestType: "EMAIL_SIGNIN", email, continueUrl }),
      z.unknown(),
    );
  }

  /** Step 2: the link from the email. Returns the session and a first ID token. */
  async signInWithEmailLink(email: string, link: string): Promise<{ session: TFirebaseSession } & TIdToken> {
    const oobCode = oobCodeOf(link);
    if (oobCode === null) throw new FirebaseError(400, "That isn't a sign-in link");
    const r = await call(
      `${this.base("identitytoolkit")}/accounts:signInWithEmailLink?key=${this.cfg.apiKey}`,
      jsonInit({ email, oobCode }),
      emailLinkResultSchema,
    );
    return {
      session: { uid: r.localId, email: r.email ?? email, refreshToken: r.refreshToken },
      idToken: r.idToken,
      expiresAt: Date.now() + Number(r.expiresIn) * 1000,
    };
  }

  /** A fresh ID token. Firebase may rotate the refresh token; the new one is returned. */
  async refresh(refreshToken: string): Promise<TIdToken & { refreshToken: string }> {
    const r = await call(
      `${this.base("securetoken")}/token?key=${this.cfg.apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      },
      refreshResultSchema,
    );
    return {
      idToken: r.id_token,
      refreshToken: r.refresh_token,
      expiresAt: Date.now() + Number(r.expires_in) * 1000,
    };
  }

  /**
   * Emulator only: sends a sign-in link to `email` and reads it back from the emulator's
   * mailbox, so tests and local work can sign in without email.
   */
  async emulatorSignInLink(email: string): Promise<string> {
    const host = this.cfg.emulators?.auth;
    if (host === undefined) throw new FirebaseError(400, "Not using the Auth emulator");
    await this.sendEmailLink(email, "http://localhost/sign-in");
    const { oobCodes } = await call(
      `http://${host}/emulator/v1/projects/${this.cfg.projectId}/oobCodes`,
      { method: "GET" },
      oobCodesSchema,
    );
    const code = oobCodes.filter((c) => c.email === email && c.requestType === "EMAIL_SIGNIN").at(-1);
    if (!code) throw new FirebaseError(404, "The emulator sent no link");
    return `http://localhost/sign-in?mode=signIn&oobCode=${encodeURIComponent(code.oobCode)}`;
  }
}

/** Expiry margin: refresh a minute before an ID token runs out. */
const MARGIN_MS = 60_000;

/**
 * Hands out ID tokens for one session, refreshing when close to expiry. `onRotate` persists a
 * rotated refresh token.
 */
export class TokenSource {
  private cached: TIdToken | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(
    private readonly auth: FirebaseAuth,
    private session: TFirebaseSession,
    private readonly onRotate: (session: TFirebaseSession) => void = () => undefined,
    first: TIdToken | null = null,
  ) {
    this.cached = first;
  }

  get uid(): string {
    return this.session.uid;
  }

  idToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - MARGIN_MS > Date.now())
      return Promise.resolve(this.cached.idToken);
    this.refreshing ??= this.auth
      .refresh(this.session.refreshToken)
      .then((r) => {
        this.cached = { idToken: r.idToken, expiresAt: r.expiresAt };
        if (r.refreshToken !== this.session.refreshToken) {
          this.session = { ...this.session, refreshToken: r.refreshToken };
          this.onRotate(this.session);
        }
        return r.idToken;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
}
