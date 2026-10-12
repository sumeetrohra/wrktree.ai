import type { IPushSender } from "#src/shared/push.types.js";
import { PUSH_MESSAGE } from "#src/shared/relay.constants.js";

/** Expo's push API. The body is fixed: no content ever goes in a push. */
export class ExpoPushSender implements IPushSender {
  constructor(private readonly accessToken: string | undefined) {}

  async send(_deviceId: string, expoPushToken: string): Promise<void> {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify({ to: expoPushToken, ...PUSH_MESSAGE, priority: "high", data: { wake: true } }),
    });
    if (!res.ok) throw new Error(`push service returned ${String(res.status)}`);
  }
}
