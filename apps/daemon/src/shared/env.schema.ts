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
  /** With AGENTDECK_DEV_AGENTS: the id the scripted agent registers under (store screenshots). */
  AGENTDECK_DEV_AGENT_ID: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,30}$/)
    .optional(),
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
  /** This computer's name on the account (default: the OS hostname). */
  AGENTDECK_HOST_NAME: z.string().min(1).max(100).optional(),
  /** Where `agentdeck login` sends the user to approve the link (the web app). */
  AGENTDECK_APP_URL: z.url().optional(),
  /** The app's web export (`apps/mobile/dist`), served as the desktop web UI. */
  AGENTDECK_WEB_ROOT: z.string().min(1).optional(),
  /** `file` skips the OS keystore and keeps the identity secret in a 0600 file (tests, headless). */
  AGENTDECK_KEYSTORE: z.enum(["os", "file"]).optional(),
  /** The GitHub CLI used for pull requests (default `gh`; a `.js` file runs under Node, for tests). */
  GH_BIN: z.string().min(1).optional(),
  /** Passed to `gh` only (never to agents or scripts): how it signs in when not via `gh auth login`. */
  GH_TOKEN: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GH_CONFIG_DIR: z.string().optional(),
  GH_HOST: z.string().optional(),
  /**
   * Phase 4d: where new worktrees go (default: next to the repo; on Windows a short folder under
   * %LOCALAPPDATA%, so deep paths stay under the 260-character limit).
   */
  AGENTDECK_WORKTREE_ROOT: z.string().min(1).optional(),
  /** Phase 4d: `0` lets the computer sleep while agents work (default: kept awake). */
  AGENTDECK_KEEP_AWAKE: flag,
  APPDATA: z.string().optional(),
  LOCALAPPDATA: z.string().optional(),
  XDG_DATA_HOME: z.string().optional(),
});
export type TDaemonEnv = z.infer<typeof daemonEnvSchema>;

export function readDaemonEnv(): TDaemonEnv {
  return daemonEnvSchema.parse(process.env);
}
