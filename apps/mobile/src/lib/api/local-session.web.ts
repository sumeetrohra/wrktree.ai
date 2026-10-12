import { z } from "zod";

const KEY = "agentdeck.localToken";
const sessionSchema = z.object({ token: z.string().min(1) });

/**
 * The desktop web UI, served by the daemon: `agentdeck open` puts a one-time code in the URL
 * fragment, traded here for the local token (same-origin, never in the page or a URL). The token
 * stays in this tab's sessionStorage so reloads keep working. Null when not served by a daemon.
 */
export function localSession(): Promise<{ url: string; token: string } | null> | null {
  const { location, sessionStorage, history } = globalThis;
  const wsUrl = `${location.origin.replace(/^http/, "ws")}/v1/ws`;
  const saved = sessionStorage.getItem(KEY);
  if (saved !== null) return Promise.resolve({ url: wsUrl, token: saved });
  const code = /^#code=([0-9a-f]{32})$/.exec(location.hash)?.[1];
  if (code === undefined) return null;
  history.replaceState(null, "", location.pathname);
  return fetch(`${location.origin}/v1/web-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  })
    .then(async (res) => (res.ok ? sessionSchema.parse(await res.json()) : null))
    .then((s) => {
      if (!s) return null;
      sessionStorage.setItem(KEY, s.token);
      return { url: wsUrl, token: s.token };
    })
    .catch(() => null);
}
