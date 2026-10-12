import type { IMailer } from "./mailer.types.js";

/** Development: codes go to an outbox readable at GET /v1/dev/outbox instead of an inbox. */
export class DevMailer implements IMailer {
  constructor(private readonly record: (to: string, code: string) => Promise<void>) {}

  sendCode(to: string, code: string): Promise<void> {
    return this.record(to, code);
  }
}
