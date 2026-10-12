import { z } from "zod";

/** Every setting the relay reads, on either host. Secrets come from the environment only. */
export const relayEnvSchema = z.object({
  RELAY_PUBLIC_URL: z.url().default("http://127.0.0.1:8787"),
  /** The Firebase project whose ID tokens sign users in. Required unless RELAY_DEV=1. */
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  /** "1" enables the dev ID-token issuer, the recording push sender and /v1/dev/* routes. */
  RELAY_DEV: z.enum(["0", "1"]).default("0"),
  /** Signs dev ID tokens. Read only when RELAY_DEV=1. */
  RELAY_DEV_SECRET: z.string().min(32).optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
});
export type TRelayEnv = z.infer<typeof relayEnvSchema>;
