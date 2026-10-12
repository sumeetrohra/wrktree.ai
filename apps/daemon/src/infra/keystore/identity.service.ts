import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  exportIdentity,
  fromB64,
  generateIdentity,
  importIdentity,
  open,
  randomBytes,
  seal,
  toB64,
  utf8ToBytes,
  bytesToUtf8,
  type TIdentity,
} from "@agentdeck/crypto";
import { parseJson, type ILogger } from "@agentdeck/shared";
import { z } from "zod";

import { osKeystore } from "./os-keystore.utils.js";

const storedSchema = z.object({ signPub: z.string(), signSec: z.string() });
const AD = utf8ToBytes("agentdeck/identity/v1");

export type TIdentityFiles = { identity: string; secretFile: string };

/**
 * The sealing secret: from the OS keystore when there is one, else a 0600 file next to the
 * identity (with a warning, as the spec allows). `file` mode skips the keystore (tests, CI).
 */
async function sealingSecret(files: TIdentityFiles, mode: "os" | "file", log: ILogger): Promise<Uint8Array> {
  const store = mode === "os" ? osKeystore(`${files.secretFile}.dpapi`) : null;
  if (store) {
    const existing = await store.read();
    if (existing !== null) return fromB64(existing);
    if (!existsSync(files.identity)) {
      const secret = toB64(randomBytes(32));
      if (await store.write(secret)) {
        log.info({ keystore: store.name }, "identity secret stored in the OS keystore");
        return fromB64(secret);
      }
    }
    log.warn({ keystore: store.name }, "OS keystore unavailable; keeping the identity secret in a 0600 file");
  }
  if (existsSync(files.secretFile)) return fromB64(readFileSync(files.secretFile, "utf8").trim());
  const secret = toB64(randomBytes(32));
  writeFileSync(files.secretFile, secret, { mode: 0o600, flag: "wx" });
  return fromB64(secret);
}

/** This machine's long-term identity, created on first run. Throws if it exists but can't be opened. */
export async function loadIdentity(
  files: TIdentityFiles,
  mode: "os" | "file",
  log: ILogger,
): Promise<TIdentity> {
  const key = await sealingSecret(files, mode, log);
  if (existsSync(files.identity)) {
    const plain = open(key, fromB64(readFileSync(files.identity, "utf8").trim()), AD);
    if (!plain) throw new Error(`Cannot open ${files.identity}: its sealing secret is missing or changed.`);
    return importIdentity(parseJson(storedSchema, bytesToUtf8(plain)));
  }
  const id = generateIdentity();
  const sealed = seal(key, utf8ToBytes(JSON.stringify(exportIdentity(id))), AD);
  writeFileSync(files.identity, toB64(sealed), { mode: 0o600, flag: "wx" });
  return id;
}
