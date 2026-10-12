import { verifyRegistration, verifyRevocation } from "@agentdeck/crypto";
import type { TRegisterBody } from "@agentdeck/protocol";
import { newId, ok } from "@agentdeck/shared";

import type { IClock } from "#src/shared/clock.types.js";
import { fail, type TRelayResult } from "#src/shared/failure.types.js";
import { randomCode, randomToken, sha256 } from "#src/shared/hash.utils.js";
import { RELAY_LIMITS } from "#src/shared/relay.constants.js";
import type { ISql } from "#src/shared/sql.types.js";

import {
  accountRowSchema,
  DIRECTORY_SCHEMA,
  deviceRowSchema,
  magicRowSchema,
  outboxRowSchema,
  pairingRowSchema,
  pushRowSchema,
  type TDeviceRow,
} from "./directory.schema.js";
import type { IDirectory, TClaimed, TDevice, TRegistered } from "./directory.types.js";

const toDevice = (r: TDeviceRow): TDevice => ({
  id: r.id,
  accountId: r.account_id,
  kind: r.kind,
  name: r.name,
  signPub: r.sign_pub,
  createdAt: r.created_at,
  revokedAt: r.revoked_at,
});

const DEVICE_COLUMNS = "id, account_id, kind, name, sign_pub, created_at, revoked_at";

export class DirectoryService implements IDirectory {
  constructor(
    private readonly sql: ISql,
    private readonly clock: IClock,
  ) {
    sql.exec(DIRECTORY_SCHEMA);
  }

  private one<T>(rows: unknown[], parse: (row: unknown) => T): T | null {
    const [row] = rows;
    return row === undefined ? null : parse(row);
  }

  private createAccount(fields: { email?: string; githubId?: string; placeholder: boolean }): string {
    const id = newId("acct");
    this.sql.run(
      "INSERT INTO accounts (id, email, github_id, placeholder, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      fields.email ?? null,
      fields.githubId ?? null,
      fields.placeholder ? 1 : 0,
      this.clock.now(),
    );
    return id;
  }

  async startMagic(email: string): Promise<string> {
    const code = randomCode();
    this.sql.run(
      "INSERT OR REPLACE INTO magic_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)",
      email.toLowerCase(),
      await sha256(code),
      this.clock.now() + RELAY_LIMITS.magicCodeTtlMs,
    );
    return code;
  }

  async finishMagic(email: string, code: string): Promise<TRelayResult<string>> {
    const addr = email.toLowerCase();
    const row = this.one(
      this.sql.all("SELECT code_hash, expires_at, attempts FROM magic_codes WHERE email = ?", addr),
      (r) => magicRowSchema.parse(r),
    );
    if (!row || row.expires_at < this.clock.now() || row.attempts >= RELAY_LIMITS.magicCodeAttempts) {
      return fail(401, "code expired");
    }
    if (row.code_hash !== (await sha256(code))) {
      this.sql.run("UPDATE magic_codes SET attempts = attempts + 1 WHERE email = ?", addr);
      return fail(401, "wrong code");
    }
    this.sql.run("DELETE FROM magic_codes WHERE email = ?", addr);
    const existing = this.one(
      this.sql.all("SELECT id, placeholder FROM accounts WHERE email = ?", addr),
      (r) => accountRowSchema.parse(r),
    );
    return ok(existing?.id ?? this.createAccount({ email: addr, placeholder: false }));
  }

  accountForGithub(githubId: string): Promise<string> {
    const existing = this.one(
      this.sql.all("SELECT id, placeholder FROM accounts WHERE github_id = ?", githubId),
      (r) => accountRowSchema.parse(r),
    );
    return Promise.resolve(existing?.id ?? this.createAccount({ githubId, placeholder: false }));
  }

  private deviceRow(id: string): TDevice | null {
    return this.one(this.sql.all(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = ?`, id), (r) =>
      toDevice(deviceRowSchema.parse(r)),
    );
  }

  /**
   * Registers a device, or re-registers it with a fresh token. The signature proves the key behind
   * the id. A phone joins the signed-in account; a daemon without one gets a placeholder account
   * until a phone claims its pairing offer.
   */
  async register(body: TRegisterBody, accountId: string | null): Promise<TRelayResult<TRegistered>> {
    if (!verifyRegistration(body, this.clock.now())) return fail(401, "bad signature");
    if (body.kind !== "daemon" && accountId === null) return fail(401, "sign in first");
    const token = randomToken();
    const tokenHash = await sha256(token);
    const existing = this.deviceRow(body.deviceId);
    if (existing) {
      if (existing.revokedAt !== null) return fail(403, "device revoked");
      const target = accountId ?? existing.accountId;
      this.sql.run(
        "UPDATE devices SET token_hash = ?, name = ?, account_id = ? WHERE id = ?",
        tokenHash,
        body.name,
        target,
        body.deviceId,
      );
      const moved = target !== existing.accountId ? existing.accountId : null;
      return ok({ deviceToken: token, accountId: target, previousAccountId: moved });
    }
    const target = accountId ?? this.createAccount({ placeholder: true });
    this.sql.run(
      "INSERT INTO devices (id, account_id, kind, name, sign_pub, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      body.deviceId,
      target,
      body.kind,
      body.name,
      body.signPub,
      tokenHash,
      this.clock.now(),
    );
    return ok({ deviceToken: token, accountId: target, previousAccountId: null });
  }

  async deviceByToken(token: string): Promise<TDevice | null> {
    const hash = await sha256(token);
    return this.one(this.sql.all(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE token_hash = ?`, hash), (r) =>
      toDevice(deviceRowSchema.parse(r)),
    );
  }

  device(id: string): Promise<TDevice | null> {
    return Promise.resolve(this.deviceRow(id));
  }

  listDevices(accountId: string): Promise<TDevice[]> {
    const rows = this.sql.all(
      `SELECT ${DEVICE_COLUMNS} FROM devices WHERE account_id = ? ORDER BY created_at`,
      accountId,
    );
    return Promise.resolve(rows.map((r) => toDevice(deviceRowSchema.parse(r))));
  }

  createPairing(daemonDeviceId: string): Promise<{ pairingId: string; expiresAt: number }> {
    const pairingId = newId("pair");
    const expiresAt = this.clock.now() + RELAY_LIMITS.pairingTtlMs;
    this.sql.run("DELETE FROM pairings WHERE expires_at < ?", this.clock.now());
    this.sql.run(
      "INSERT INTO pairings (id, daemon_device_id, expires_at) VALUES (?, ?, ?)",
      pairingId,
      daemonDeviceId,
      expiresAt,
    );
    return Promise.resolve({ pairingId, expiresAt });
  }

  /** Puts the offering daemon on the phone's account. One-time; expires after ten minutes. */
  claimPairing(accountId: string, pairingId: string, phoneDeviceId: string): Promise<TRelayResult<TClaimed>> {
    const result = ((): TRelayResult<TClaimed> => {
      const pairing = this.one(
        this.sql.all(
          "SELECT id, daemon_device_id, expires_at, claimed_at FROM pairings WHERE id = ?",
          pairingId,
        ),
        (r) => pairingRowSchema.parse(r),
      );
      if (!pairing || pairing.expires_at < this.clock.now()) return fail(410, "pairing expired");
      if (pairing.claimed_at !== null) return fail(409, "pairing already used");
      const phone = this.deviceRow(phoneDeviceId);
      if (phone?.accountId !== accountId || phone.revokedAt !== null)
        return fail(403, "phone not on this account");
      const daemon = this.deviceRow(pairing.daemon_device_id);
      if (daemon?.revokedAt !== null) return fail(404, "daemon not found");
      const current = this.one(
        this.sql.all("SELECT id, placeholder FROM accounts WHERE id = ?", daemon.accountId),
        (r) => accountRowSchema.parse(r),
      );
      if (current?.placeholder === 0 && current.id !== accountId) {
        return fail(409, "daemon belongs to another account");
      }
      this.sql.run("UPDATE pairings SET claimed_at = ? WHERE id = ?", this.clock.now(), pairingId);
      this.sql.run("UPDATE devices SET account_id = ? WHERE id = ?", accountId, daemon.id);
      return ok({ daemonDeviceId: daemon.id, previousAccountId: daemon.accountId });
    })();
    return Promise.resolve(result);
  }

  /** Needs the signature of a daemon on the same account, so a stolen session alone can't revoke. */
  revoke(
    accountId: string,
    deviceId: string,
    confirm: { daemonDeviceId: string; at: number; sig: string },
  ): Promise<TRelayResult<TDevice>> {
    const result = ((): TRelayResult<TDevice> => {
      const target = this.deviceRow(deviceId);
      if (target?.accountId !== accountId) return fail(404, "device not found");
      const daemon = this.deviceRow(confirm.daemonDeviceId);
      if (daemon?.accountId !== accountId || daemon.kind !== "daemon" || daemon.revokedAt !== null) {
        return fail(403, "confirmation must come from a daemon on this account");
      }
      if (!verifyRevocation(daemon.signPub, deviceId, confirm.at, confirm.sig, this.clock.now())) {
        return fail(403, "bad confirmation");
      }
      const at = target.revokedAt ?? this.clock.now();
      this.sql.run(
        "UPDATE devices SET revoked_at = ?, token_hash = ? WHERE id = ?",
        at,
        `revoked:${deviceId}`,
        deviceId,
      );
      return ok({ ...target, revokedAt: at });
    })();
    return Promise.resolve(result);
  }

  recordOutbox(to: string, code: string): Promise<void> {
    this.sql.run("INSERT INTO dev_outbox (to_addr, code, at) VALUES (?, ?, ?)", to, code, this.clock.now());
    return Promise.resolve();
  }

  outbox(): Promise<{ to: string; code: string; at: number }[]> {
    const rows = this.sql.all("SELECT to_addr AS 'to', code, at FROM dev_outbox ORDER BY at");
    return Promise.resolve(rows.map((r) => outboxRowSchema.parse(r)));
  }

  recordPush(push: { deviceId: string; token: string; title: string; body: string }): Promise<void> {
    this.sql.run(
      "INSERT INTO dev_pushes (device_id, token, title, body, at) VALUES (?, ?, ?, ?, ?)",
      push.deviceId,
      push.token,
      push.title,
      push.body,
      this.clock.now(),
    );
    return Promise.resolve();
  }

  pushes(): Promise<{ deviceId: string; token: string; title: string; body: string; at: number }[]> {
    const rows = this.sql.all(
      "SELECT device_id AS deviceId, token, title, body, at FROM dev_pushes ORDER BY at",
    );
    return Promise.resolve(rows.map((r) => pushRowSchema.parse(r)));
  }
}
