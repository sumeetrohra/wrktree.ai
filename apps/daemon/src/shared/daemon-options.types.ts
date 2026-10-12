export type TDaemonOptions = {
  home: string;
  /** Folders `fs.browse` and `repo.add` may reach. Defaults to the user's home folder. */
  browseRoots: readonly string[];
  portRange: readonly [number, number];
  /** Register the scripted `fake` agent (tests and demos only). */
  devAgents: boolean;
  /** Backoff before each automatic adapter restart, in ms. */
  restartBackoffMs: readonly number[];
  /** Coalescing window for streaming patches (≤ 20 per second per chat by default). */
  patchIntervalMs: number;
  /** Extra browser origins allowed on the local transport (development only; SEC4). */
  devOrigins: readonly string[];
  /** Relay base URL, or null to run local-only. */
  relayUrl: string | null;
  /** The desktop web UI's files, or null to serve none. */
  webRoot: string | null;
  /** Where the identity's sealing secret lives. */
  keystore: "os" | "file";
};
