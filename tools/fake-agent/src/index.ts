#!/usr/bin/env node
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";
import { z } from "zod";

import { FakeAgent } from "./fake-agent.service.js";

const env = z.object({ FAKE_AGENT_HOME: z.string().optional() }).parse(process.env);
const home = env.FAKE_AGENT_HOME ?? join(process.cwd(), ".fake-agent");

// A daemon that dies leaves our stdin at EOF; exit instead of lingering.
process.stdin.on("end", () => process.exit(0));

const output: WritableStream<Uint8Array> = Writable.toWeb(process.stdout);

const input: ReadableStream<Uint8Array> = Readable.toWeb(process.stdin);
// eslint-disable-next-line @typescript-eslint/no-deprecated -- reason: see FakeAgent's constructor
new acp.AgentSideConnection((conn) => new FakeAgent(conn, home), acp.ndJsonStream(output, input));
