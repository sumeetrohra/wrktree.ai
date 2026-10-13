#!/usr/bin/env node
/**
 * A stand-in for the GitHub CLI: just the `gh pr` calls the daemon makes, against the repo's local
 * bare `origin`. Pull requests live in `fake-gh.json` in the git dir; `pr merge` really merges the
 * branch into the origin's `main`, so a test can check the result with git. Every call is recorded.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseJson } from "@agentdeck/shared";
import { z } from "zod";

import { FAKE_GH_LOGGED_OUT_FILE, FAKE_GH_STATE_FILE } from "./paths.constants.js";

const prSchema = z.object({
  number: z.number(),
  url: z.string(),
  state: z.enum(["OPEN", "MERGED", "CLOSED"]),
  isDraft: z.boolean(),
  title: z.string(),
  body: z.string(),
  headRefName: z.string(),
});
const stateSchema = z.object({ prs: z.array(prSchema), calls: z.array(z.array(z.string())) });
type TState = z.infer<typeof stateSchema>;

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const cwd = process.cwd();
const gitDir = resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"]));
const stateFile = join(gitDir, FAKE_GH_STATE_FILE);

function load(): TState {
  if (!existsSync(stateFile)) return { prs: [], calls: [] };
  return parseJson(stateSchema, readFileSync(stateFile, "utf8"));
}
const save = (s: TState): void => {
  writeFileSync(stateFile, JSON.stringify(s, null, 2));
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const args = process.argv.slice(2);
const state = load();
state.calls.push(args);
save(state);

if (existsSync(join(gitDir, FAKE_GH_LOGGED_OUT_FILE))) {
  fail("To get started with GitHub CLI, please run:  gh auth login", 4);
}

const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
const current = (): z.infer<typeof prSchema> | undefined =>
  state.prs.filter((p) => p.headRefName === branch).at(-1);
const view = (p: z.infer<typeof prSchema>) => ({
  number: p.number,
  url: p.url,
  state: p.state,
  isDraft: p.isDraft,
});

const [group, cmd, ...rest] = args;
if (group === "auth" && cmd === "status") {
  process.stdout.write("Logged in to github.com as fake-user\n");
} else if (group === "pr" && cmd === "view") {
  const pr = current();
  if (!pr) fail(`no pull requests found for branch "${branch}"`);
  process.stdout.write(JSON.stringify(view(pr)));
} else if (group === "pr" && cmd === "create") {
  if (!git(cwd, ["ls-remote", "--heads", "origin", branch])) {
    fail(`aborted: you must first push the current branch to a remote`);
  }
  if (current()?.state === "OPEN") fail(`a pull request for branch "${branch}" already exists`);
  const number = state.prs.length + 1;
  const pr = {
    number,
    url: `https://github.com/fake/repo/pull/${String(number)}`,
    state: "OPEN" as const,
    isDraft: rest.includes("--draft"),
    title: flag(rest, "--title") ?? "",
    body: flag(rest, "--body-file") === "-" ? readFileSync(0, "utf8") : "",
    headRefName: branch,
  };
  state.prs.push(pr);
  save(state);
  process.stdout.write(`${pr.url}\n`);
} else if (group === "pr" && cmd === "merge") {
  const pr = current();
  if (pr?.state !== "OPEN") fail(`no open pull request for branch "${branch}"`);
  if (pr.isDraft) fail("Pull request is still a draft");
  const origin = git(cwd, ["remote", "get-url", "origin"]);
  const clone = mkdtempSync(join(tmpdir(), "fake-gh-"));
  try {
    execFileSync("git", ["clone", "-q", origin, clone], { stdio: "ignore" });
    const id = ["-c", "user.name=fake-gh", "-c", "user.email=fake-gh@agentdeck.dev"];
    git(clone, [...id, "merge", "--no-ff", "-m", `${pr.title} (#${String(pr.number)})`, `origin/${branch}`]);
    git(clone, ["push", "-q", "origin", "HEAD:main"]);
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
  pr.state = "MERGED";
  save(state);
  process.stdout.write(`Merged pull request #${String(pr.number)}\n`);
} else {
  fail(`fake-gh: unsupported command: ${args.join(" ")}`);
}
