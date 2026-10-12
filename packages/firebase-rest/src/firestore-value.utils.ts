import { z } from "zod";

/** Plain JSON data as stored in Firestore documents. */
export type TJson = null | boolean | number | string | TJson[] | { [key: string]: TJson };

/** Firestore's wire format for one value (the subset this package writes and reads). */
export type TFsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { arrayValue: { values?: TFsValue[] | undefined } }
  | { mapValue: { fields?: Record<string, TFsValue> | undefined } };

export const fsValueSchema: z.ZodType<TFsValue> = z.lazy(() =>
  z.union([
    z.object({ nullValue: z.null() }),
    z.object({ booleanValue: z.boolean() }),
    z.object({ integerValue: z.string() }),
    z.object({ doubleValue: z.number() }),
    z.object({ stringValue: z.string() }),
    z.object({ arrayValue: z.object({ values: z.array(fsValueSchema).optional() }) }),
    z.object({ mapValue: z.object({ fields: z.record(z.string(), fsValueSchema).optional() }) }),
    // Values this package never writes (timestamps, references, …) read back as null.
    z.looseObject({}).transform((): TFsValue => ({ nullValue: null })),
  ]),
);

export function encodeValue(v: TJson): TFsValue {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(v) } };
}

export function encodeFields(o: Record<string, TJson>): Record<string, TFsValue> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, encodeValue(v)]));
}

export function decodeValue(v: TFsValue): TJson {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decodeValue);
  return decodeFields(v.mapValue.fields ?? {});
}

export function decodeFields(fields: Record<string, TFsValue>): Record<string, TJson> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}
