import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

/** "3 minutes ago" for an epoch-ms timestamp. The only place the app touches dates (I2, L7). */
export function fromNow(epochMs: number): string {
  return dayjs(epochMs).fromNow();
}

/** Milliseconds since the epoch: the protocol's time unit. */
export function nowMs(): number {
  return dayjs().valueOf();
}
