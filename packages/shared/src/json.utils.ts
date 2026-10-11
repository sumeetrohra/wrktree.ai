import type { z } from "zod";

/**
 * The only sanctioned way to turn untrusted JSON text into a value: parse, then validate
 * against `schema`. Throws a `JsonParseError` describing what was wrong.
 */
export function parseJson<S extends z.ZodType>(schema: S, text: string): z.infer<S> {
  let raw: unknown;
  try {
    // eslint-disable-next-line no-restricted-syntax -- reason: this is the one validated JSON.parse wrapper
    raw = JSON.parse(text);
  } catch (e) {
    throw new JsonParseError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new JsonParseError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return result.data;
}

/** Like `parseJson`, but returns `undefined` instead of throwing (for line-by-line tool output). */
export function tryParseJson<S extends z.ZodType>(schema: S, text: string): z.infer<S> | undefined {
  try {
    return parseJson(schema, text);
  } catch {
    return undefined;
  }
}

export class JsonParseError extends Error {
  override name = "JsonParseError";
}
