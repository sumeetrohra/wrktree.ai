/**
 * Preview hosts are `<token>.<preview domain>`. A token is the account's ULID (lowercase, so it
 * survives DNS case folding) followed by 128 random bits in hex: the relay finds the account's hub
 * from the host alone, and nobody can guess a token.
 */
const ACCOUNT_CHARS = 26;
const TOKEN = /^[0-9a-z]{26}[0-9a-f]{32}$/;

export function previewToken(accountId: string): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  );
  return `${accountId.slice("acct_".length).toLowerCase()}${random.join("")}`;
}

export function accountOfToken(token: string): string {
  return `acct_${token.slice(0, ACCOUNT_CHARS).toUpperCase()}`;
}

/** The preview token in a `Host` header, or null when the host isn't a preview host. */
export function previewTokenOf(host: string | null | undefined, domains: readonly string[]): string | null {
  if (!host) return null;
  const name = host.toLowerCase().replace(/:\d+$/, "");
  for (const d of domains) {
    if (!name.endsWith(`.${d}`)) continue;
    const label = name.slice(0, -(d.length + 1));
    return TOKEN.test(label) ? label : null;
  }
  return null;
}

/**
 * Where previews are served: `PREVIEW_DOMAIN` (a wildcard DNS name pointing at the relay), plus
 * `preview.localhost` on dev relays, which browsers resolve to this machine without any DNS.
 */
export function previewDomains(env: { PREVIEW_DOMAIN?: string | undefined; RELAY_DEV: "0" | "1" }): string[] {
  return [
    ...(env.PREVIEW_DOMAIN ? [env.PREVIEW_DOMAIN.toLowerCase()] : []),
    ...(env.RELAY_DEV === "1" ? ["preview.localhost"] : []),
  ];
}

/** The URL a token is served at, seen from a request that reached this relay at `base`. */
export function previewUrl(
  token: string,
  env: { PREVIEW_DOMAIN?: string | undefined; RELAY_DEV: "0" | "1" },
  base: URL,
): string | null {
  if (env.PREVIEW_DOMAIN) return `https://${token}.${env.PREVIEW_DOMAIN}/`;
  if (env.RELAY_DEV === "1")
    return `${base.protocol}//${token}.preview.localhost${base.port ? `:${base.port}` : ""}/`;
  return null;
}
