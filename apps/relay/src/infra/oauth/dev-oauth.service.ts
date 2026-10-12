import type { IOAuthProvider } from "./oauth.types.js";

/** Development: any code `dev-<login>` signs in as that login. */
export class DevOAuth implements IOAuthProvider {
  constructor(private readonly publicUrl: string) {}

  authorizeUrl(state: string): string {
    return `${this.publicUrl}/v1/dev/github?state=${encodeURIComponent(state)}`;
  }

  exchange(code: string): Promise<string> {
    if (!/^dev-[a-z0-9-]{1,39}$/.test(code)) return Promise.reject(new Error("bad dev code"));
    return Promise.resolve(`github-dev:${code.slice(4)}`);
  }
}
