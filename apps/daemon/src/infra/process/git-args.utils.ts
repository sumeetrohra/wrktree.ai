import { AgentdeckError } from "@agentdeck/protocol";

/**
 * Rejects a client-supplied ref or path that git could read as an option (`--upload-pack=…`)
 * or that carries control characters. Ref syntax itself is checked by `git check-ref-format`.
 */
export function assertSafeGitArg(value: string, what: string): string {
  let hasControl = false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) hasControl = true;
  }
  if (value.length === 0 || value.startsWith("-") || hasControl) {
    throw new AgentdeckError("INVALID_ARGS", `Unsafe ${what}: ${JSON.stringify(value)}`);
  }
  return value;
}
