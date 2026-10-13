import { z } from "zod";

/** `config.json` in the daemon's home, written by the CLI. Unknown keys are kept for later phases. */
export const daemonConfigSchema = z.looseObject({
  relayUrl: z.url().optional(),
  appUrl: z.url().optional(),
  /** Phase 4d: false lets the computer sleep while agents work. */
  keepAwake: z.boolean().optional(),
  /** Phase 5: true lets other devices on the account open terminals here (SEC25). */
  remoteTerminal: z.boolean().optional(),
});
export type TDaemonConfig = z.infer<typeof daemonConfigSchema>;
