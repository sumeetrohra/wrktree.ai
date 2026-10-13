import { z } from "zod";

/** `.agentdeck/config.json` in a repo. */
export const repoConfigSchema = z.object({
  setup: z.array(z.string()).default([]),
  teardown: z.array(z.string()).default([]),
  hiddenGlobs: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  /**
   * Named commands (e.g. `dev`, `test`) a client may start in a worktree by name; nothing else can
   * be run (SEC). Each runs through the shell with `PORT` set to the worktree's preview port.
   */
  scripts: z.record(z.string().regex(/^[\w.:-]{1,100}$/), z.string().min(1)).default({}),
  /**
   * Phase 3c: which script serves the worktree's app for Preview, and env hints for running it
   * behind the tunnel (e.g. an HMR client port of 443). Without it, Preview is off for the repo.
   */
  preview: z
    .object({
      script: z.string().regex(/^[\w.:-]{1,100}$/),
      env: z.record(z.string(), z.string()).default({}),
    })
    .optional(),
});
export type TRepoConfig = z.infer<typeof repoConfigSchema>;
