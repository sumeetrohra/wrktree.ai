import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TLoggedEvent, TWorktree } from "@agentdeck/protocol";
import { newId, silentLogger } from "@agentdeck/shared";
import { describe, expect, it } from "vitest";

import { EventBus } from "#src/infra/bus/index.js";
import { openDb } from "#src/infra/db/index.js";
import type { TRuntime } from "#src/infra/runtime/index.js";
import { pathsFor } from "#src/shared/paths.utils.js";

import { TerminalsService } from "./terminals.service.js";

/**
 * Windows runs the tests in cmd.exe: PowerShell's line editor, scripted through ConPTY on a CI
 * runner, never acts on Enter (PowerShell itself is checked by hand; docs/phase-5.md).
 */
const WIN = process.platform === "win32";
const SHELL = WIN ? "cmd.exe" : null;
const PROMPT = WIN ? /[A-Z]:\\[^>\r\n]*>/ : /[$#%>] ?$/m;
/** A sum, so seeing the answer proves the shell ran it (its echo doesn't contain the answer). */
const SUM = WIN ? "set /a 6*7+1000\r" : "echo sum-$((20+22))\r";
const ANSWER = WIN ? "1042" : "sum-42";

function setup(idleMs?: number) {
  const dir = mkdtempSync(join(tmpdir(), "terms-"));
  const db = openDb(join(dir, "db"));
  const bus = new EventBus(join(dir, "events"), db);
  const rt = { db, bus, log: silentLogger, paths: pathsFor(dir), opts: {} } as TRuntime;
  const wt: TWorktree = {
    id: newId("wt"),
    repoId: newId("repo"),
    title: "Feature",
    branch: "feature",
    baseRef: "main",
    path: dir,
    status: "ready",
    port: 41234,
    setupError: null,
    createdAt: 1,
    archivedAt: null,
  };
  const blobs = new Map<string, Buffer>();
  const terms = new TerminalsService(
    rt,
    { worktree: () => wt },
    {
      put: (bytes, mime) => {
        blobs.set("b", bytes);
        return { blobId: "b", mime, size: bytes.length };
      },
    },
    { idleMs, shell: SHELL },
  );
  const events: TLoggedEvent[] = [];
  bus.on((e) => events.push(e));
  const output = (termId: string): string =>
    events
      .flatMap((e) => (e.event.type === "term.output" && e.event.termId === termId ? [e.event.data] : []))
      .join("");
  const until = async (check: () => boolean): Promise<void> => {
    for (let i = 0; i < 800 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
    expect(check()).toBe(true);
  };
  return { wt, terms, events, blobs, output, until };
}

// PowerShell takes seconds to start on a Windows runner.
describe("TerminalsService", { timeout: 30_000 }, () => {
  it("runs commands in the worktree and streams their output on term:<id>", async () => {
    const { wt, terms, events, blobs, output, until } = setup();
    const t = await terms.open(wt.id, 80, 24);
    expect(t).toMatchObject({ worktreeId: wt.id, status: "running", cols: 80, rows: 24 });
    // Type at the prompt, as a person does.
    await until(() => PROMPT.test(output(t.id)));
    terms.input(t.id, SUM);
    await until(() => output(t.id).includes(ANSWER));
    expect(events.some((e) => e.topic === `repo:${wt.repoId}` && e.event.type === "term.status")).toBe(true);

    expect(terms.resize(t.id, 120, 40)).toMatchObject({ cols: 120, rows: 40 });
    expect(terms.list(wt.id)).toEqual([expect.objectContaining({ id: t.id, cols: 120 })]);

    const { cursor } = terms.output(t.id);
    expect(blobs.get("b")?.toString()).toContain(ANSWER);
    expect(cursor).toBeGreaterThan(0);

    const closed = await terms.close(t.id);
    expect(closed.status).toBe("exited");
    expect(() => {
      terms.input(t.id, "ls\r");
    }).toThrow(/exited/);
  });

  it("closes a terminal nobody types in", async () => {
    const { wt, terms, until } = setup(300);
    const t = await terms.open(wt.id, 80, 24);
    await until(() => terms.list(wt.id)[0]?.status === "exited");
    expect(t.status).toBe("running");
  });

  it("caps open terminals per worktree and closes them all", async () => {
    const { wt, terms } = setup();
    for (let i = 0; i < 4; i++) await terms.open(wt.id, 80, 24);
    await expect(terms.open(wt.id, 80, 24)).rejects.toThrow(/At most 4/);
    await terms.closeAll(wt.id);
    expect(terms.list(wt.id).every((t) => t.status === "exited")).toBe(true);
  });
});
