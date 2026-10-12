import type { ILogger } from "@agentdeck/shared";

type TLevel = "debug" | "info" | "warn" | "error";

function line(level: TLevel, fields: Record<string, unknown>, msg?: string): string {
  return JSON.stringify({ level, time: Date.now(), ...fields, ...(msg === undefined ? {} : { msg }) });
}

/**
 * JSON lines on stdout. Workers only collect `console` output, and the self-host build runs in a
 * container that collects stdout, so both hosts share this. Callers never pass message content.
 */
export function createConsoleLogger(minLevel: TLevel = "info"): ILogger {
  const order: TLevel[] = ["debug", "info", "warn", "error"];
  const on = (l: TLevel): boolean => order.indexOf(l) >= order.indexOf(minLevel);
  /* eslint-disable no-console -- reason: this is the relay's one log sink (see doc comment) */
  const logger: ILogger = {
    debug: (f, m) => {
      if (on("debug")) console.log(line("debug", f, m));
    },
    info: (f, m) => {
      if (on("info")) console.log(line("info", f, m));
    },
    warn: (f, m) => {
      if (on("warn")) console.log(line("warn", f, m));
    },
    error: (f, m) => {
      if (on("error")) console.log(line("error", f, m));
    },
    child: () => logger,
  };
  /* eslint-enable no-console -- reason: end of the log sink */
  return logger;
}
