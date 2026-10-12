import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { run, runWithInput } from "../process/index.js";

const SERVICE = "agentdeck";
const ACCOUNT = "identity";

/** A secret kept by the operating system. Each returns null when its backend isn't usable. */
export type TOsKeystore = {
  name: string;
  read(): Promise<string | null>;
  write(secret: string): Promise<boolean>;
};

const isSecret = (s: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(s);

/** macOS Keychain via `security`. */
const keychain: TOsKeystore = {
  name: "macOS Keychain",
  async read() {
    const r = await run("security", ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"]);
    const v = r.stdout.trim();
    return r.code === 0 && isSecret(v) ? v : null;
  },
  async write(secret) {
    // `security` has no stdin mode; the secret is on argv for the life of this one short call.
    const r = await run("security", [
      "add-generic-password",
      "-a",
      ACCOUNT,
      "-s",
      SERVICE,
      "-w",
      secret,
      "-U",
    ]);
    return r.code === 0;
  },
};

/** libsecret (GNOME Keyring, KWallet) via `secret-tool`, secret on stdin. */
const libsecret: TOsKeystore = {
  name: "libsecret",
  async read() {
    try {
      const r = await run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]);
      const v = r.stdout.trim();
      return r.code === 0 && isSecret(v) ? v : null;
    } catch {
      return null;
    }
  },
  async write(secret) {
    try {
      const args = ["store", "--label=Agentdeck identity", "service", SERVICE, "account", ACCOUNT];
      return (await runWithInput("secret-tool", args, secret)).code === 0;
    } catch {
      return false;
    }
  },
};

/** Windows DPAPI (CurrentUser scope): the protected blob lives in a file only this user can unprotect. */
function dpapi(blobFile: string): TOsKeystore {
  const ps = (script: string, input: string) =>
    runWithInput("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], input);
  return {
    name: "Windows DPAPI",
    async read() {
      if (!existsSync(blobFile)) return null;
      const script =
        "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());" +
        "[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";
      const r = await ps(script, readFileSync(blobFile, "utf8"));
      const v = r.stdout.trim();
      return r.code === 0 && isSecret(v) ? v : null;
    },
    async write(secret) {
      const script =
        "Add-Type -AssemblyName System.Security; $s=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd().Trim());" +
        "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($s,$null,'CurrentUser'))";
      const r = await ps(script, secret);
      if (r.code !== 0) return false;
      writeFileSync(blobFile, r.stdout.trim(), { mode: 0o600 });
      return true;
    },
  };
}

export function osKeystore(dpapiBlobFile: string): TOsKeystore | null {
  switch (process.platform) {
    case "darwin":
      return keychain;
    case "win32":
      return dpapi(dpapiBlobFile);
    case "linux":
      return libsecret;
    default:
      return null;
  }
}
