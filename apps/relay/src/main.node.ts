#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";

import { startNodeRelay } from "#src/app/node-host.js";
import { relayEnvSchema } from "#src/shared/relay-env.schema.js";

const env = relayEnvSchema.parse(process.env);
const port = Number(process.env["PORT"] ?? "8787");
const host = process.env["HOST"] ?? "127.0.0.1";
const dataDir = process.env["RELAY_DATA_DIR"] ?? join(homedir(), ".agentdeck-relay");
await startNodeRelay({ port, host, dataDir, env });
