/** Sends a content-free wake-up push. */
export interface IPushSender {
  send(deviceId: string, expoPushToken: string): Promise<void>;
}
