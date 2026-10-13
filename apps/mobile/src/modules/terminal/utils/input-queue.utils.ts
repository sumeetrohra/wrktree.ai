/**
 * Keystrokes for one terminal, sent in order with at most one `term.input` in flight: whatever is
 * typed meanwhile goes in the next one. Fast typing or a paste then costs a few relay frames, not
 * one per key (the relay limits frames per second).
 */
export class InputQueue {
  private pending = "";
  private sending = false;

  constructor(
    private readonly send: (data: string) => Promise<unknown>,
    private readonly onError: (e: unknown) => void = () => undefined,
  ) {}

  push(data: string): void {
    this.pending += data;
    if (!this.sending) void this.drain();
  }

  private async drain(): Promise<void> {
    this.sending = true;
    while (this.pending !== "") {
      const data = this.pending;
      this.pending = "";
      try {
        await this.send(data);
      } catch (e) {
        this.onError(e);
      }
    }
    this.sending = false;
  }
}
