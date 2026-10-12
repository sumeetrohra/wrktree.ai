import { z } from "zod";

/** Every setting the relay reads, on either host. Secrets come from the environment only. */
export const relayEnvSchema = z.object({
  RELAY_PUBLIC_URL: z.url().default("http://127.0.0.1:8787"),
  RELAY_JWT_SECRET: z.string().min(32),
  /** "1" enables the dev mailer, dev OAuth, the recording push sender and /v1/dev/* routes. */
  RELAY_DEV: z.enum(["0", "1"]).default("0"),
  RESEND_API_KEY: z.string().optional(),
  RELAY_MAIL_FROM: z.string().default("Agentdeck <login@agentdeck.dev>"),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
});
export type TRelayEnv = z.infer<typeof relayEnvSchema>;
