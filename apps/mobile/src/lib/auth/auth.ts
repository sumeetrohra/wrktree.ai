import { devIdTokenResultSchema, relayRoutes } from "@agentdeck/protocol";
import { z } from "zod";

import { nowMs } from "@/shared/utils/datetime-utils";

import { secureStore } from "../secure-store";
import { storage } from "../storage";

/**
 * Signing in. Production uses Firebase Auth through its REST API (the same code on web and
 * native, no SDK); the relay only ever sees the resulting ID token. Builds with
 * `EXPO_PUBLIC_DEV_AUTH=1` can also sign in with the relay's dev issuer (tests, local work).
 */

const envSchema = z.object({
  EXPO_PUBLIC_FIREBASE_API_KEY: z.string().min(1).optional(),
  EXPO_PUBLIC_DEV_AUTH: z.enum(["0", "1"]).optional(),
  EXPO_PUBLIC_RELAY_URL: z.url().optional(),
  EXPO_PUBLIC_APP_URL: z.url().optional(),
});
const env = envSchema.parse({
  EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  EXPO_PUBLIC_DEV_AUTH: process.env.EXPO_PUBLIC_DEV_AUTH,
  EXPO_PUBLIC_RELAY_URL: process.env.EXPO_PUBLIC_RELAY_URL,
  EXPO_PUBLIC_APP_URL: process.env.EXPO_PUBLIC_APP_URL,
});

const IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/v1/accounts";
const SECURE_TOKEN = "https://securetoken.googleapis.com/v1/token";
/** Refresh a minute before the token runs out. */
const EXPIRY_MARGIN_MS = 60_000;

const userSchema = z.object({
  provider: z.enum(["firebase", "dev"]),
  uid: z.string(),
  email: z.string().nullable(),
  /** Dev sign-in mints tokens from this relay. */
  relayUrl: z.string().optional(),
});
export type TAuthUser = z.infer<typeof userSchema>;

const KEYS = { user: "auth.user", pendingEmail: "auth.pendingEmail", refresh: "auth.refreshToken" } as const;

const firebaseErrorSchema = z.object({ error: z.object({ message: z.string() }) });
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
});

/** Sign-in failed; `reason` is the provider's message (e.g. INVALID_OOB_CODE). */
class AuthError extends Error {
  override name = "AuthError";
}

let cached: { token: string; expiresAt: number } | null = null;

async function post<S extends z.ZodType>(
  url: string,
  body: BodyInit,
  schema: S,
  form = false,
): Promise<z.infer<S>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
    body,
  });
  const json: unknown = await res.json();
  if (!res.ok)
    throw new AuthError(firebaseErrorSchema.safeParse(json).data?.error.message ?? "sign-in failed");
  return schema.parse(json);
}

function needApiKey(): string {
  if (env.EXPO_PUBLIC_FIREBASE_API_KEY === undefined)
    throw new AuthError("Sign-in isn't configured in this build");
  return env.EXPO_PUBLIC_FIREBASE_API_KEY;
}

function keep(user: TAuthUser, token: { idToken: string; expiresInS: number; refreshToken?: string }): void {
  storage.set(KEYS.user, user);
  if (token.refreshToken !== undefined) secureStore.set(KEYS.refresh, token.refreshToken);
  cached = { token: token.idToken, expiresAt: nowMs() + token.expiresInS * 1000 };
}

/** The oobCode in an email sign-in link (or in a link nested in its `link`/`continueUrl`). */
function oobCodeOf(link: string): string | null {
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

export const auth = {
  /** Which ways to sign in this build offers. */
  methods: { email: env.EXPO_PUBLIC_FIREBASE_API_KEY !== undefined, dev: env.EXPO_PUBLIC_DEV_AUTH === "1" },

  /** The relay the build points at (sign-in screens let the user change it). */
  defaultRelayUrl: env.EXPO_PUBLIC_RELAY_URL ?? "https://relay.agentdeck.dev",

  user: (): TAuthUser | null => storage.get(KEYS.user, userSchema) ?? null,

  /** Step 1 of email sign-in: Firebase emails a link. */
  async sendEmailLink(email: string): Promise<void> {
    const continueUrl = `${env.EXPO_PUBLIC_APP_URL ?? "https://app.agentdeck.dev"}/sign-in`;
    await post(
      `${IDENTITY_TOOLKIT}:sendOobCode?key=${needApiKey()}`,
      JSON.stringify({ requestType: "EMAIL_SIGNIN", email, continueUrl }),
      z.object({}).loose(),
    );
    storage.set(KEYS.pendingEmail, email);
  },

  /** The address the last link was sent to (needed to finish on this device). */
  pendingEmail: (): string | null => storage.get(KEYS.pendingEmail, z.string()) ?? null,

  isSignInLink: (link: string): boolean => oobCodeOf(link) !== null,

  /** Step 2: the link from the email (opened in the app, or pasted). */
  async completeEmailLink(email: string, link: string): Promise<TAuthUser> {
    const oobCode = oobCodeOf(link);
    if (oobCode === null) throw new AuthError("That isn't a sign-in link");
    const r = await post(
      `${IDENTITY_TOOLKIT}:signInWithEmailLink?key=${needApiKey()}`,
      JSON.stringify({ email, oobCode }),
      emailLinkResultSchema,
    );
    const user: TAuthUser = { provider: "firebase", uid: r.localId, email: r.email ?? email };
    keep(user, { idToken: r.idToken, expiresInS: Number(r.expiresIn), refreshToken: r.refreshToken });
    storage.remove(KEYS.pendingEmail);
    return user;
  },

  /** Dev builds only: any uid, signed by the relay's dev issuer. */
  async signInDev(relayUrl: string, uid: string): Promise<TAuthUser> {
    if (!auth.methods.dev) throw new AuthError("Dev sign-in is off in this build");
    const user: TAuthUser = { provider: "dev", uid, email: `${uid}@example.com`, relayUrl };
    storage.set(KEYS.user, user);
    cached = null;
    await auth.idToken();
    return user;
  },

  /** A fresh ID token for the signed-in user, refreshed when close to expiry. */
  async idToken(): Promise<string> {
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > nowMs()) return cached.token;
    const user = auth.user();
    if (!user) throw new AuthError("Not signed in");
    if (user.provider === "dev") {
      const q = `uid=${encodeURIComponent(user.uid)}&email=${encodeURIComponent(user.email ?? "")}`;
      const res = await fetch(`${user.relayUrl ?? auth.defaultRelayUrl}${relayRoutes.devIdToken.path}?${q}`);
      if (!res.ok) throw new AuthError(`dev sign-in failed (${String(res.status)})`);
      const { idToken } = devIdTokenResultSchema.parse(await res.json());
      keep(user, { idToken, expiresInS: 3600 });
      return idToken;
    }
    const refreshToken = secureStore.get(KEYS.refresh);
    if (refreshToken === null) throw new AuthError("Signed out; sign in again");
    const r = await post(
      `${SECURE_TOKEN}?key=${needApiKey()}`,
      `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      refreshResultSchema,
      true,
    );
    keep(user, { idToken: r.id_token, expiresInS: Number(r.expires_in), refreshToken: r.refresh_token });
    return r.id_token;
  },

  signOut(): void {
    cached = null;
    storage.remove(KEYS.user);
    secureStore.remove(KEYS.refresh);
  },
};
