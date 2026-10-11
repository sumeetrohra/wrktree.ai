import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loggedEventSchema, type TDaemonEvent, type TLoggedEvent } from "@agentdeck/protocol";
import { now, parseJson } from "@agentdeck/shared";

import type { TDb } from "../db/index.js";

import { topicMatches } from "./topic.utils.js";

export type TListener = (e: TLoggedEvent) => void;

/** `chat:abc` → `chat__abc.jsonl`; colons are not allowed in Windows file names. */
const fileName = (topic: string): string => `${topic.replace(":", "__")}.jsonl`;
const topicOf = (file: string): string => file.replace(/\.jsonl$/, "").replace("__", ":");

/**
 * Topic event bus backed by one append-only JSONL file per topic.
 * A topic's cursor is the line number of its latest event, so a client that
 * remembers its last cursor can replay exactly what it missed.
 */
export class EventBus {
  private readonly cursors = new Map<string, number>();
  private readonly listeners = new Set<TListener>();
  private readonly setCursor;

  constructor(
    private readonly dir: string,
    db: TDb,
  ) {
    mkdirSync(dir, { recursive: true });
    this.setCursor = db.prepare(
      "INSERT INTO topic_cursors (topic, cursor) VALUES (?, ?) ON CONFLICT(topic) DO UPDATE SET cursor = excluded.cursor",
    );
    // The files are the source of truth; topic_cursors is a cache that a crash may leave stale.
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const lines = readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).length;
      this.cursors.set(topicOf(f), lines);
      this.setCursor.run(topicOf(f), lines);
    }
  }

  publish(topic: string, event: TDaemonEvent): TLoggedEvent {
    const cursor = (this.cursors.get(topic) ?? 0) + 1;
    const logged: TLoggedEvent = { topic, cursor, at: now(), event };
    appendFileSync(join(this.dir, fileName(topic)), JSON.stringify(logged) + "\n");
    this.cursors.set(topic, cursor);
    this.setCursor.run(topic, cursor);
    for (const l of this.listeners) l(logged);
    return logged;
  }

  cursor(topic: string): number {
    return this.cursors.get(topic) ?? 0;
  }

  /** Topics with at least one event that `pattern` covers. */
  topics(pattern: string): string[] {
    return [...this.cursors.keys()].filter((t) => topicMatches(pattern, t)).sort();
  }

  /** Events of `topic` with cursor > `after`, oldest first. */
  replay(topic: string, after: number): TLoggedEvent[] {
    const file = join(this.dir, fileName(topic));
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .slice(after)
      .filter(Boolean)
      .map((line) => parseJson(loggedEventSchema, line));
  }

  on(listener: TListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
