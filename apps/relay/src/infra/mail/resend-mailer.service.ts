import type { IMailer } from "./mailer.types.js";

/** Sends the magic-link code through Resend's HTTP API. */
export class ResendMailer implements IMailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendCode(to: string, code: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to,
        subject: `Your Agentdeck code: ${code}`,
        text: `Your Agentdeck sign-in code is ${code}. It expires in 10 minutes.`,
      }),
    });
    if (!res.ok) throw new Error(`mail provider returned ${String(res.status)}`);
  }
}
