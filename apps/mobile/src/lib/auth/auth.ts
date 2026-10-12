import {
  FirebaseAuth,
  TokenSource,
  type TFirebaseConfig,
  type TFirebaseSession,
} from "@agentdeck/firebase-rest";
import {
  devIdTokenResultSchema,
  relayConfigSchema,
  relayRoutes,
  type TRelayConfig,
} from "@agentdeck/protocol";
import { Platform } from "react-native";
import { z } from "zod";

import { nowMs } from "@/shared/utils/datetime-utils";

import { secureStore } from "../secure-store";
import { storage } from "../storage";

/**
 * Signing in. The relay hands out its sign-in setup (`GET /v1/config`): a Firebase project (email
 * link, through @agentdeck/firebase-rest; the relay only ever sees the resulting ID token), and on a
 * dev relay a dev sign-in (the Auth emulator when the relay uses one, else the relay's own issuer).
 */

const envSchema = z.object({
  EXPO_PUBLIC_RELAY_URL: z.url().optional(),
  EXPO_PUBLIC_APP_URL: z.url().optional(),
});
const env = envSchema.parse({
  EXPO_PUBLIC_RELAY_URL: process.env.EXPO_PUBLIC_RELAY_URL,
  EXPO_PUBLIC_APP_URL: process.env.EXPO_PUBLIC_APP_URL,
});

const userSchema = z.object({
  /** `firebase`: a Firebase session (refresh token in the keychain). `dev`: the relay's dev issuer. */
  provider: z.enum(["firebase", "dev"]),
  uid: z.string(),
  email: z.string().nullable(),
  relayUrl: z.string(),
});
export type TAuthUser = z.infer<typeof userSchema>;

const KEYS = { user: "auth.user", pendingEmail: "auth.pendingEmail", refresh: "auth.refreshToken" } as const;
const DEV_TOKEN_S = 3600;
/** Refresh a minute before a dev token runs out. */
const MARGIN_MS = 60_000;

class AuthError extends Error {
  override name = "AuthError";
}

let devToken: { token: string; expiresAt: number } | null = null;
let tokens: TokenSource | null = null;
const configs = new Map<string, Promise<TRelayConfig>>();

/** Where email sign-in links come back to: this web app, or the configured app URL. */
function appUrl(): string {
  if (env.EXPO_PUBLIC_APP_URL !== undefined) return env.EXPO_PUBLIC_APP_URL;
  return Platform.OS === "web" ? globalThis.location.origin : "https://app.agentdeck.dev";
}

function firebaseOf(cfg: TRelayConfig): TFirebaseConfig {
  if (!cfg.firebase) throw new AuthError("This relay has no Firebase project");
  return cfg.firebase;
}

function keepFirebase(
  relayUrl: string,
  session: TFirebaseSession,
  first: { idToken: string; expiresAt: number },
  cfg: TFirebaseConfig,
): TAuthUser {
  const user: TAuthUser = { provider: "firebase", uid: session.uid, email: session.email, relayUrl };
  storage.set(KEYS.user, user);
  secureStore.set(KEYS.refresh, session.refreshToken);
  tokens = new TokenSource(
    new FirebaseAuth(cfg),
    session,
    (s) => {
      secureStore.set(KEYS.refresh, s.refreshToken);
    },
    first,
  );
  return user;
}

export const auth = {
  /** The relay the build points at (sign-in lets the user change it). */
  defaultRelayUrl: env.EXPO_PUBLIC_RELAY_URL ?? "https://relay.agentdeck.dev",

  /** The relay's sign-in setup, fetched once per relay. */
  config(relayUrl: string): Promise<TRelayConfig> {
    const url = relayUrl.replace(/\/$/, "");
    let cached = configs.get(url);
    if (!cached) {
      cached = fetch(`${url}${relayRoutes.config.path}`)
        .then(async (res) => {
          if (!res.ok) throw new AuthError(`The relay answered ${String(res.status)}`);
          return relayConfigSchema.parse(await res.json());
        })
        .catch((e: unknown) => {
          configs.delete(url);
          throw e instanceof Error ? e : new AuthError("Can't reach the relay");
        });
      configs.set(url, cached);
    }
    return cached;
  },

  user: (): TAuthUser | null => storage.get(KEYS.user, userSchema) ?? null,

  /** Step 1 of email sign-in: Firebase emails a link back to this app's `/sign-in`. */
  async sendEmailLink(relayUrl: string, email: string): Promise<void> {
    const cfg = firebaseOf(await auth.config(relayUrl));
    await new FirebaseAuth(cfg).sendEmailLink(email, `${appUrl()}/sign-in`);
    storage.set(KEYS.pendingEmail, email);
  },

  /** The address the last link was sent to (needed to finish on this device). */
  pendingEmail: (): string | null => storage.get(KEYS.pendingEmail, z.string()) ?? null,

  /** Step 2: the link from the email (opened in the app, or pasted). */
  async completeEmailLink(relayUrl: string, email: string, link: string): Promise<TAuthUser> {
    const cfg = firebaseOf(await auth.config(relayUrl));
    const r = await new FirebaseAuth(cfg).signInWithEmailLink(email, link);
    storage.remove(KEYS.pendingEmail);
    return keepFirebase(relayUrl, r.session, r, cfg);
  },

  /**
   * Dev relays only: sign in as `uid`. With the Auth emulator this is a real email-link sign-in for
   * `<uid>@example.com` (its link read from the emulator), so every device of that user shares the
   * account; otherwise the relay's own dev issuer.
   */
  async signInDev(relayUrl: string, uid: string): Promise<TAuthUser> {
    const cfg = await auth.config(relayUrl);
    if (!cfg.devSignIn) throw new AuthError("Dev sign-in is only for dev relays");
    const email = `${uid}@example.com`;
    if (cfg.firebase?.emulators?.auth !== undefined) {
      const fa = new FirebaseAuth(cfg.firebase);
      const r = await fa.signInWithEmailLink(email, await fa.emulatorSignInLink(email));
      return keepFirebase(relayUrl, r.session, r, cfg.firebase);
    }
    const user: TAuthUser = { provider: "dev", uid, email, relayUrl };
    storage.set(KEYS.user, user);
    devToken = null;
    await auth.idToken();
    return user;
  },

  /** A fresh ID token for the signed-in user. */
  async idToken(): Promise<string> {
    const user = auth.user();
    if (!user) throw new AuthError("Not signed in");
    if (user.provider === "firebase") return (await auth.firebase()).tokens.idToken();
    if (devToken && devToken.expiresAt - MARGIN_MS > nowMs()) return devToken.token;
    const q = `uid=${encodeURIComponent(user.uid)}&email=${encodeURIComponent(user.email ?? "")}`;
    const res = await fetch(`${user.relayUrl}${relayRoutes.devIdToken.path}?${q}`);
    if (!res.ok) throw new AuthError(`dev sign-in failed (${String(res.status)})`);
    const { idToken } = devIdTokenResultSchema.parse(await res.json());
    devToken = { token: idToken, expiresAt: nowMs() + DEV_TOKEN_S * 1000 };
    return idToken;
  },

  /** The Firebase project and ID tokens, for reading cloud history. Throws without a Firebase session. */
  async firebase(): Promise<{ config: TFirebaseConfig; tokens: TokenSource; uid: string }> {
    const user = auth.user();
    if (user?.provider !== "firebase") throw new AuthError("Not signed in with Firebase");
    const cfg = firebaseOf(await auth.config(user.relayUrl));
    if (!tokens) {
      const refreshToken = secureStore.get(KEYS.refresh);
      if (refreshToken === null) throw new AuthError("Signed out; sign in again");
      tokens = new TokenSource(
        new FirebaseAuth(cfg),
        { uid: user.uid, email: user.email, refreshToken },
        (s) => {
          secureStore.set(KEYS.refresh, s.refreshToken);
        },
      );
    }
    return { config: cfg, tokens, uid: user.uid };
  },

  signOut(): void {
    devToken = null;
    tokens = null;
    storage.remove(KEYS.user);
    secureStore.remove(KEYS.refresh);
  },
};
