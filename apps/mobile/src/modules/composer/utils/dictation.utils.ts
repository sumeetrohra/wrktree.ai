/** Joins non-empty pieces of text with single spaces. */
function join(...parts: readonly string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .join(" ");
}

/**
 * One dictation into the composer: what was typed before stays, finished utterances accumulate
 * after it, and the utterance in progress is shown at the end until it is final.
 */
export class DictationSession {
  private said = "";
  /** Stops the recognizer; set once it has started. */
  stop: (() => void) | null = null;

  constructor(private readonly before: string) {}

  /** The composer's text after a recognition result. */
  result(text: string, final: boolean): string {
    const shown = join(this.before, this.said, text);
    if (final) this.said = join(this.said, text);
    return shown;
  }
}
