import { tryParseJson } from "@agentdeck/shared";
import { createMMKV } from "react-native-mmkv";
import type { z } from "zod";

const mmkv = createMMKV({ id: "agentdeck" });

/** Fast synchronous key-value storage (MMKV on native, localStorage on web). Values are zod-checked on read. */
export const storage = {
  get<S extends z.ZodType>(key: string, schema: S): z.infer<S> | undefined {
    const raw = mmkv.getString(key);
    return raw === undefined ? undefined : tryParseJson(schema, raw);
  },
  set(key: string, value: unknown): void {
    mmkv.set(key, JSON.stringify(value));
  },
  remove(key: string): void {
    mmkv.remove(key);
  },
};
