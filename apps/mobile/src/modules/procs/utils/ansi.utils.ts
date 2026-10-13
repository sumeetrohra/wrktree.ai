// eslint-disable-next-line no-control-regex -- reason: matching terminal escape sequences is the point
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\r(?!\n)/g;

/** Terminal colors, cursor moves and lone carriage returns, removed for a plain log view. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}
