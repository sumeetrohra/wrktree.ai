import { fileURLToPath } from "node:url";

/** Absolute path of the fake `gh`: point the daemon's `GH_BIN` at it. */
export const fakeGhEntry = fileURLToPath(new URL("./index.js", import.meta.url));
/** In the repo's git dir: the fake's pull requests (JSON). */
export const FAKE_GH_STATE_FILE = "fake-gh.json";
/** In the repo's git dir: while it exists, every command fails as if `gh` were logged out. */
export const FAKE_GH_LOGGED_OUT_FILE = "fake-gh-logged-out";
