import { z } from "zod";

/** Every setting the relay reads, on either host. Secrets come from the environment only. */
export const relayEnvSchema = z.object({
  RELAY_PUBLIC_URL: z.url().default("http://127.0.0.1:8787"),
  /** The Firebase project whose ID tokens sign users in. Required unless RELAY_DEV=1. */
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  /** Public client settings, handed to devices at `GET /v1/config` (they ship in the app anyway). */
  FIREBASE_API_KEY: z.string().min(1).optional(),
  FIREBASE_STORAGE_BUCKET: z.string().min(1).optional(),
  /** Dev only (RELAY_DEV=1): the Firebase Emulator Suite, trusted for sign-in and handed to devices. */
  FIREBASE_AUTH_EMULATOR_HOST: z.string().min(1).optional(),
  FIRESTORE_EMULATOR_HOST: z.string().min(1).optional(),
  FIREBASE_STORAGE_EMULATOR_HOST: z.string().min(1).optional(),
  /** "1" enables the dev ID-token issuer, the recording push sender and /v1/dev/* routes. */
  RELAY_DEV: z.enum(["0", "1"]).default("0"),
  /** Signs dev ID tokens. Read only when RELAY_DEV=1. */
  RELAY_DEV_SECRET: z.string().min(32).optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
});
export type TRelayEnv = z.infer<typeof relayEnvSchema>;
