import { z } from "zod";

import type { IOAuthProvider } from "./oauth.types.js";

const tokenSchema = z.object({ access_token: z.string() });
const userSchema = z.object({ id: z.number() });

export class GithubOAuth implements IOAuthProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  authorizeUrl(state: string): string {
    const q = new URLSearchParams({ client_id: this.clientId, state, scope: "read:user" });
    return `https://github.com/login/oauth/authorize?${q.toString()}`;
  }

  async exchange(code: string): Promise<string> {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: this.clientId, client_secret: this.clientSecret, code }),
    });
    const { access_token: accessToken } = tokenSchema.parse(await tokenRes.json());
    const userRes = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${accessToken}`, "user-agent": "agentdeck-relay" },
    });
    return `github:${String(userSchema.parse(await userRes.json()).id)}`;
  }
}
