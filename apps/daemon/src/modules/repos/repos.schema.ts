import { z } from "zod";

/** `.agentdeck/config.json` in a repo. */
export const repoConfigSchema = z.object({
  setup: z.array(z.string()).default([]),
  teardown: z.array(z.string()).default([]),
  hiddenGlobs: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});
export type TRepoConfig = z.infer<typeof repoConfigSchema>;
