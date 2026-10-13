import type { EventBus } from "#src/infra/bus/index.js";
import type { BlobStore } from "#src/modules/blobs/index.js";
import type { DevicesService } from "#src/modules/devices/index.js";
import type { FileJail } from "#src/modules/files/index.js";
import type { GitService } from "#src/modules/git/index.js";
import type { GithubService } from "#src/modules/github/index.js";
import type { PreviewService } from "#src/modules/preview/index.js";
import type { ProcsService } from "#src/modules/procs/index.js";
import type { ProfilesService } from "#src/modules/profiles/index.js";
import type { ReposService } from "#src/modules/repos/index.js";
import type { SessionManager } from "#src/modules/sessions/index.js";
import type { WorktreesService } from "#src/modules/worktrees/index.js";

import type { Remote } from "./remote.service.js";

/** Everything handlers may use: the wired modules plus a few daemon-level facts. */
export type TModules = {
  daemonId: string;
  bus: EventBus;
  repos: ReposService;
  profiles: ProfilesService;
  worktrees: WorktreesService;
  sessions: SessionManager;
  blobs: BlobStore;
  git: GitService;
  /** Pull requests through `gh` on this computer. */
  github: GithubService;
  /** Repo scripts running in worktrees. */
  procs: ProcsService;
  /** Preview tunnels to worktrees' dev servers (Phase 3c). */
  preview: PreviewService;
  devices: DevicesService;
  /** A one-time link to the desktop web UI, or null when none is configured. */
  webLink: () => string | null;
  /** Account link, relay socket and consumer sessions (started once the identity is loaded). */
  remote: Remote;
  /** The path jail for one worktree, built from its repo's hidden globs. */
  jailFor: (worktreeId: string) => FileJail;
};
