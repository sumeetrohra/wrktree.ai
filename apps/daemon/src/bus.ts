import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonEvent, LoggedEvent } from "@agentdeck/protocol";
import { now } from "@agentdeck/shared";
import type { Db } from "./db/index.js";

export type Listener = (e: LoggedEvent) => void;

/** `chat:abc` → `chat__abc.jsonl`; colons are not allowed in Windows file names. */
const fileName = (topic: string) => `${topic.replace(":", "__")}.jsonl`;
const topicOf = (file: string) => file.replace(/\.jsonl$/, "").replace("__", ":");

/** True when a subscription key (`chat:*`, `global`, `repo:repo_…`) covers `topic`. */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  if (pattern.endsWith(":*")) return topic.startsWith(pattern.slice(0, -1));
  return false;
}

/**
 * Topic event bus backed by one append-only JSONL file per topic.
 * A topic's cursor is the line number of its latest event, so a client that
 * remembers its last cursor can replay exactly what it missed.
 */
export class EventBus {
  private cursors = new Map<string, number>();
  private listeners = new Set<Listener>();
  private setCursor;

  constructor(
    private readonly dir: string,
    db: Db,
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

  publish(topic: string, event: DaemonEvent): LoggedEvent {
    const cursor = (this.cursors.get(topic) ?? 0) + 1;
    const logged: LoggedEvent = { topic, cursor, at: now(), event };
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
  replay(topic: string, after: number): LoggedEvent[] {
    const file = join(this.dir, fileName(topic));
    if (!existsSync(file)) return [];
    const out: LoggedEvent[] = [];
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = after; i < lines.length; i++) {
      const line = lines[i];
      if (line) out.push(JSON.parse(line) as LoggedEvent);
    }
    return out;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
