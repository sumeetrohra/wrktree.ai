import { z } from "zod";

/** `config.json` in the daemon's home, written by the CLI. Unknown keys are kept for later phases. */
export const daemonConfigSchema = z.looseObject({ relayUrl: z.url().optional() });
export type TDaemonConfig = z.infer<typeof daemonConfigSchema>;
