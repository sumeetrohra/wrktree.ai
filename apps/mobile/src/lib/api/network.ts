/**
 * Native: the OS closes sockets when the network goes away, and the connection retries with
 * backoff, so there is nothing to watch.
 */
export function watchNetwork(_onChange: (online: boolean) => void): void {
  // nothing to do
}
