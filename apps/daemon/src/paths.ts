import { homedir } from "node:os";
import { join } from "node:path";

/** The daemon's data folder. `AGENTDECK_HOME` overrides it (tests, multiple daemons). */
export function defaultHome(): string {
  if (process.env.AGENTDECK_HOME) return process.env.AGENTDECK_HOME;
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "agentdeck");
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "agentdeck");
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "agentdeck");
  }
}

export type Paths = ReturnType<typeof pathsFor>;

export function pathsFor(home: string) {
  return {
    home,
    db: join(home, "agentdeck.db"),
    events: join(home, "events"),
    blobs: join(home, "blobs"),
    uploads: join(home, "uploads"),
    profiles: join(home, "profiles"),
    shared: join(home, "shared"),
    logs: join(home, "logs"),
    /** Written on start: `{ pid, port, version }` so the CLI can find the daemon. */
    daemonJson: join(home, "daemon.json"),
    /** Local transport bearer token, mode 0600. */
    localToken: join(home, "local-token"),
  };
}
