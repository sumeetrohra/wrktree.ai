import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

/** The only place the app touches dates (I2, L7). Time travels as epoch milliseconds. */
export function now(): number {
  return dayjs().valueOf();
}

/** "3 minutes ago" for an epoch-ms timestamp. */
export function fromNow(epochMs: number): string {
  return dayjs(epochMs).fromNow();
}
