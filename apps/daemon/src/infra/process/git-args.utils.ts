import { AgentdeckError } from "@agentdeck/protocol";

/**
 * Rejects a client-supplied ref or path that git could read as an option (`--upload-pack=…`)
 * or that carries control characters. Ref syntax itself is checked by `git check-ref-format`.
 */
export function assertSafeGitArg(value: string, what: string): string {
  if (value.length === 0 || value.startsWith("-") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AgentdeckError("INVALID_ARGS", `Unsafe ${what}: ${JSON.stringify(value)}`);
  }
  return value;
}
