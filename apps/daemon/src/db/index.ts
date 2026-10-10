import Database from "better-sqlite3";
import { migrations } from "./migrations.js";

export type Db = Database.Database;

/** Opens the SQLite file in WAL mode and applies pending migrations (tracked in `user_version`). */
export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}
