/** Package entry for the CLI and tests. */
export { runDaemon } from "#src/app/run-daemon.js";
export { Daemon, optionsFromEnv } from "#src/app/create-daemon.js";
export { defaultHome, pathsFor, type TPaths } from "#src/shared/paths.utils.js";
export { TOKEN_PROTOCOL_PREFIX } from "#src/infra/transport/index.js";
export { DAEMON_VERSION } from "#src/shared/version.constants.js";
