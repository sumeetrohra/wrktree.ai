import { AgentdeckError, type TPullRequest, type TWorktree } from "@agentdeck/protocol";
import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

import { childEnv, run, runWithInput, type TExecResult } from "#src/infra/process/index.js";

const viewSchema = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  state: z.string(),
  isDraft: z.boolean(),
});

const SIGN_IN = "Run `gh auth login` on this computer to open pull requests from here.";

/**
 * Pull requests through the GitHub CLI on this computer, with the user's own `gh` sign-in. `gh`
 * gets the usual allow-listed environment plus its token variables, which no other child sees
 * (SEC6). Always runs in the worktree, so `gh` picks the branch and the repo itself.
 */
export class GithubService {
  constructor(private readonly gh: { bin: string; env: Record<string, string> }) {}

  private command(args: readonly string[]): [string, string[]] {
    const { bin } = this.gh;
    return bin.endsWith(".js") ? [process.execPath, [bin, ...args]] : [bin, [...args]];
  }

  private async call(wt: TWorktree, args: readonly string[], input?: string): Promise<TExecResult> {
    const [file, argv] = this.command(args);
    const opts = { cwd: wt.path, env: childEnv({ ...this.gh.env, GH_PROMPT_DISABLED: "1" }) };
    let r: TExecResult;
    try {
      r = input === undefined ? await run(file, argv, opts) : await runWithInput(file, argv, input, opts);
    } catch {
      throw new AgentdeckError("NOT_AUTHENTICATED", `The GitHub CLI (gh) isn't installed. ${SIGN_IN}`);
    }
    const out = `${r.stderr}\n${r.stdout}`;
    if (r.code === 4 || /gh auth login|not logged in/i.test(out)) {
      throw new AgentdeckError("NOT_AUTHENTICATED", `gh isn't signed in. ${SIGN_IN}`);
    }
    return r;
  }

  private fail(what: string, r: TExecResult): never {
    throw new AgentdeckError("BAD_STATE", `gh ${what} failed: ${(r.stderr || r.stdout).trim()}`);
  }

  /** The branch's latest pull request, or null when it has none. */
  async status(wt: TWorktree): Promise<TPullRequest | null> {
    const r = await this.call(wt, ["pr", "view", "--json", "number,url,state,isDraft"]);
    if (r.code !== 0) {
      if (/no (open )?pull requests? found/i.test(r.stderr)) return null;
      this.fail("pr view", r);
    }
    const v = tryParseJson(viewSchema, r.stdout);
    if (!v) this.fail("pr view", r);
    const state = v.state.toLowerCase();
    return {
      number: v.number,
      url: v.url,
      state: state === "merged" || state === "closed" ? state : "open",
      draft: v.isDraft,
    };
  }

  /** Opens a pull request for the (pushed) branch; the body goes in on stdin. */
  async create(wt: TWorktree, title: string, body: string, draft = false): Promise<TPullRequest> {
    const args = ["pr", "create", "--title", title, "--body-file", "-", ...(draft ? ["--draft"] : [])];
    const r = await this.call(wt, args, body);
    if (r.code !== 0) this.fail("pr create", r);
    return this.require(wt);
  }

  async merge(wt: TWorktree, method: "merge" | "squash" | "rebase"): Promise<TPullRequest> {
    const r = await this.call(wt, ["pr", "merge", `--${method}`, "--delete-branch=false"]);
    if (r.code !== 0) this.fail("pr merge", r);
    return this.require(wt);
  }

  private async require(wt: TWorktree): Promise<TPullRequest> {
    const pr = await this.status(wt);
    if (!pr) throw new AgentdeckError("BAD_STATE", "gh reported no pull request for this branch");
    return pr;
  }
}
