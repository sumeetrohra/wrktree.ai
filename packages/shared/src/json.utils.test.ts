import { describe, expect, it } from "vitest";
import { z } from "zod";

import { JsonParseError, parseJson } from "./json.utils.js";

describe("parseJson", () => {
  const schema = z.object({ port: z.number() });

  it("returns validated data", () => {
    expect(parseJson(schema, '{"port":41000}')).toEqual({ port: 41000 });
  });

  it("rejects malformed JSON and wrong shapes", () => {
    expect(() => parseJson(schema, "{nope")).toThrow(JsonParseError);
    expect(() => parseJson(schema, '{"port":"41000"}')).toThrow(/port/);
  });
});
