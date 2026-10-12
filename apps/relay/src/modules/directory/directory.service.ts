import { verifyRegistration } from "@agentdeck/crypto";
import type { TRegisterBody } from "@agentdeck/protocol";
import { newId, ok } from "@agentdeck/shared";

import type { IClock } from "#src/shared/clock.types.js";
import { fail, type TRelayResult } from "#src/shared/failure.types.js";
import { randomToken, sha256 } from "#src/shared/hash.utils.js";
import type { TIdentityClaims } from "#src/shared/id-token.types.js";
import type { ISql } from "#src/shared/sql.types.js";

import {
  accountRowSchema,
  DIRECTORY_SCHEMA,
  deviceRowSchema,
  pushRowSchema,
  type TDeviceRow,
} from "./directory.schema.js";
import type { IDirectory, TDevice, TJoined } from "./directory.types.js";

const toDevice = (r: TDeviceRow): TDevice => ({
  id: r.id,
  accountId: r.account_id,
  kind: r.kind,
  name: r.name,
  signPub: r.sign_pub,
  createdAt: r.created_at,
});

const DEVICE_COLUMNS = "id, account_id, kind, name, sign_pub, created_at";

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

  accountFor(claims: TIdentityClaims): Promise<string> {
    const existing = this.one(this.sql.all("SELECT id, email FROM accounts WHERE uid = ?", claims.uid), (r) =>
      accountRowSchema.parse(r),
    );
    if (existing) {
      if (claims.email !== null && claims.email !== existing.email) {
        this.sql.run("UPDATE accounts SET email = ? WHERE id = ?", claims.email, existing.id);
      }
      return Promise.resolve(existing.id);
    }
    const id = newId("acct");
    this.sql.run(
      "INSERT INTO accounts (id, uid, email, created_at) VALUES (?, ?, ?, ?)",
      id,
      claims.uid,
      claims.email,
      this.clock.now(),
    );
    return Promise.resolve(id);
  }

  private deviceRow(id: string): TDevice | null {
    return this.one(this.sql.all(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = ?`, id), (r) =>
      toDevice(deviceRowSchema.parse(r)),
    );
  }

  /** Puts a device on an account with a fresh token, replacing any token it had. */
  private async join(
    d: Pick<TDevice, "kind" | "name" | "signPub"> & { deviceId: string },
    accountId: string,
  ): Promise<TJoined> {
    const deviceToken = randomToken();
    const tokenHash = await sha256(deviceToken);
    const existing = this.deviceRow(d.deviceId);
    if (existing) {
      this.sql.run(
        "UPDATE devices SET token_hash = ?, name = ?, account_id = ? WHERE id = ?",
        tokenHash,
        d.name,
        accountId,
        d.deviceId,
      );
      const moved = existing.accountId !== accountId ? existing.accountId : null;
      return { deviceToken, accountId, kind: existing.kind, previousAccountId: moved };
    }
    this.sql.run(
      "INSERT INTO devices (id, account_id, kind, name, sign_pub, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      d.deviceId,
      accountId,
      d.kind,
      d.name,
      d.signPub,
      tokenHash,
      this.clock.now(),
    );
    return { deviceToken, accountId, kind: d.kind, previousAccountId: null };
  }

  /** Every device, host or consumer, joins the account it signed in to; the signature proves its key. */
  async register(body: TRegisterBody, accountId: string): Promise<TRelayResult<TJoined>> {
    if (!verifyRegistration(body, this.clock.now())) return fail(401, "bad signature");
    return ok(await this.join(body, accountId));
  }

  async deviceByToken(token: string): Promise<TDevice | null> {
    const hash = await sha256(token);
    return this.one(this.sql.all(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE token_hash = ?`, hash), (r) =>
      toDevice(deviceRowSchema.parse(r)),
    );
  }

  listDevices(accountId: string): Promise<TDevice[]> {
    const rows = this.sql.all(
      `SELECT ${DEVICE_COLUMNS} FROM devices WHERE account_id = ? ORDER BY created_at`,
      accountId,
    );
    return Promise.resolve(rows.map((r) => toDevice(deviceRowSchema.parse(r))));
  }

  removeDevice(accountId: string, deviceId: string): Promise<TRelayResult<TDevice>> {
    const target = this.deviceRow(deviceId);
    if (target?.accountId !== accountId) return Promise.resolve(fail(404, "device not found"));
    this.sql.run("DELETE FROM devices WHERE id = ?", deviceId);
    return Promise.resolve(ok(target));
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
