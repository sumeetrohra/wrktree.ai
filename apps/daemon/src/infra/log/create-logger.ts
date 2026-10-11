import { pino } from "pino";

import type { ILogger } from "@agentdeck/shared";

function adapt(l: pino.Logger): ILogger {
  return {
    debug: (obj, msg) => {
      l.debug(obj, msg);
    },
    info: (obj, msg) => {
      l.info(obj, msg);
    },
    warn: (obj, msg) => {
      l.warn(obj, msg);
    },
    error: (obj, msg) => {
      l.error(obj, msg);
    },
    child: (bindings) => adapt(l.child(bindings)),
  };
}

/** JSON-lines logger writing to `file` (and stderr when asked). Never pass it message or file content. */
export function createLogger(file: string, opts: { stderr: boolean; base: Record<string, unknown> }): ILogger {
  const streams: pino.StreamEntry[] = [{ stream: pino.destination({ dest: file, mkdir: true, sync: true }) }];
  if (opts.stderr) streams.push({ stream: process.stderr });
  return adapt(pino({ base: opts.base }, pino.multistream(streams)));
}
