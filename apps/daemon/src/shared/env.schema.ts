import { z } from "zod";

const flag = z.enum(["0", "1"]).optional();

/** Every environment variable the daemon reads, validated once (TY6). */
const daemonEnvSchema = z.object({
  AGENTDECK_HOME: z.string().min(1).optional(),
  /** Path-list (`:` or `;` on Windows) of folders `fs.browse` and `repo.add` may reach. */
  AGENTDECK_BROWSE_ROOTS: z.string().min(1).optional(),
  AGENTDECK_PORT_RANGE: z
    .string()
    .regex(/^\d+-\d+$/, "expected e.g. 41000-41999")
    .optional(),
  AGENTDECK_DEV_AGENTS: flag,
  AGENTDECK_RESTART_BACKOFF_MS: z
    .string()
    .refine((v) => v.split(",").every((n) => /^\d+$/.test(n)), "expected e.g. 1000,4000,15000")
    .optional(),
  AGENTDECK_LOG_STDERR: flag,
  AGENTDECK_LOCAL_PORT: z.string().regex(/^\d+$/).optional(),
  /** Development only: comma-separated extra browser origins (e.g. an Expo dev server) allowed to connect. */
  AGENTDECK_DEV_ORIGINS: z.string().optional(),
  /** Relay base URL; overrides the one saved by `agentdeck relay set`. */
  AGENTDECK_RELAY_URL: z.url().optional(),
  /** `file` skips the OS keystore and keeps the identity secret in a 0600 file (tests, headless). */
  AGENTDECK_KEYSTORE: z.enum(["os", "file"]).optional(),
  APPDATA: z.string().optional(),
  XDG_DATA_HOME: z.string().optional(),
});
export type TDaemonEnv = z.infer<typeof daemonEnvSchema>;

export function readDaemonEnv(): TDaemonEnv {
  return daemonEnvSchema.parse(process.env);
}
