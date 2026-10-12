import type { IPushSender } from "#src/shared/push.types.js";
import { PUSH_MESSAGE } from "#src/shared/relay.constants.js";

/** Development: pushes are recorded and readable at GET /v1/dev/pushes. */
export class DevPushSender implements IPushSender {
  constructor(
    private readonly record: (push: {
      deviceId: string;
      token: string;
      title: string;
      body: string;
    }) => Promise<void>,
  ) {}

  send(deviceId: string, token: string): Promise<void> {
    return this.record({ deviceId, token, ...PUSH_MESSAGE });
  }
}
