/** Native builds never run inside the daemon's own page. */
export function localSession(): Promise<{ url: string; token: string } | null> | null {
  return null;
}
