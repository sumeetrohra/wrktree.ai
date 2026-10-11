import { DaemonClient } from "#src/lib/daemon-client/index.js";

/** Opens a client for the duration of `fn`. */
export async function withClient<T>(fn: (client: DaemonClient) => Promise<T>): Promise<T> {
  const client = await DaemonClient.connect();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}
