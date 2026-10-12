import { z } from "zod";

import type { TFirebaseConfig } from "./firebase.types.js";
import { decodeFields, encodeFields, fsValueSchema, type TJson } from "./firestore-value.utils.js";
import { call, jsonInit } from "./http.utils.js";

const documentSchema = z.object({
  name: z.string(),
  fields: z.record(z.string(), fsValueSchema).optional(),
});
const listSchema = z.object({
  documents: z.array(documentSchema).optional(),
  nextPageToken: z.string().optional(),
});
const queryResultSchema = z.array(z.object({ document: documentSchema.optional() }));

export type TDoc = { path: string; data: Record<string, TJson> };

/** One write in a commit: replace a document, merge fields into it, or delete it. */
export type TWrite =
  | { kind: "set"; path: string; data: Record<string, TJson> }
  | { kind: "merge"; path: string; data: Record<string, TJson> }
  | { kind: "delete"; path: string };

export type TWhere = { field: string; op: "EQUAL" | "GREATER_THAN" | "LESS_THAN"; value: TJson };

/**
 * Cloud Firestore over REST with the signed-in user's ID token, so security rules apply exactly as
 * for any client. Paths are relative to the database root (`users/abc/chats/c1`).
 */
export class Firestore {
  constructor(
    private readonly cfg: TFirebaseConfig,
    private readonly idToken: () => Promise<string>,
  ) {}

  private get root(): string {
    return `projects/${this.cfg.projectId}/databases/(default)/documents`;
  }

  private get base(): string {
    const host = this.cfg.emulators?.firestore;
    return host === undefined
      ? `https://firestore.googleapis.com/v1/${this.root}`
      : `http://${host}/v1/${this.root}`;
  }

  private async auth(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.idToken()}` };
  }

  private toDoc(d: z.infer<typeof documentSchema>): TDoc {
    return {
      path: d.name.slice(d.name.indexOf("/documents/") + "/documents/".length),
      data: decodeFields(d.fields ?? {}),
    };
  }

  /** Applies up to 500 writes atomically. */
  async commit(writes: readonly TWrite[]): Promise<void> {
    if (writes.length === 0) return;
    const body = {
      writes: writes.map((w) => {
        const name = `${this.root}/${w.path}`;
        if (w.kind === "delete") return { delete: name };
        const update = { name, fields: encodeFields(w.data) };
        return w.kind === "set"
          ? { update }
          : { update, updateMask: { fieldPaths: Object.keys(w.data).map(quoteField) } };
      }),
    };
    await call(`${this.base}:commit`, jsonInit(body, await this.auth()), z.unknown());
  }

  /** The document, or null when it doesn't exist. */
  async get(path: string): Promise<TDoc | null> {
    const res = await fetch(`${this.base}/${path}`, { headers: await this.auth() });
    if (res.status === 404) return null;
    const doc = documentSchema.parse(await res.json());
    return this.toDoc(doc);
  }

  /** Documents of a collection (`users/abc/chats`), optionally filtered and ordered. */
  async query(
    collectionPath: string,
    opts: { where?: TWhere[]; orderBy?: { field: string; desc?: boolean }; limit?: number } = {},
  ): Promise<TDoc[]> {
    const slash = collectionPath.lastIndexOf("/");
    const parent = slash < 0 ? this.base : `${this.base}/${collectionPath.slice(0, slash)}`;
    const collectionId = collectionPath.slice(slash + 1);
    const filters = (opts.where ?? []).map((w) => ({
      fieldFilter: {
        field: { fieldPath: quoteField(w.field) },
        op: w.op,
        value: encodeFields({ v: w.value })["v"],
      },
    }));
    const structuredQuery = {
      from: [{ collectionId }],
      ...(filters.length === 0
        ? {}
        : { where: filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } } }),
      ...(opts.orderBy
        ? {
            orderBy: [
              {
                field: { fieldPath: quoteField(opts.orderBy.field) },
                direction: opts.orderBy.desc ? "DESCENDING" : "ASCENDING",
              },
            ],
          }
        : {}),
      ...(opts.limit === undefined ? {} : { limit: opts.limit }),
    };
    const rows = await call(
      `${parent}:runQuery`,
      jsonInit({ structuredQuery }, await this.auth()),
      queryResultSchema,
    );
    return rows.flatMap((r) => (r.document ? [this.toDoc(r.document)] : []));
  }

  /** Every document of a collection, in pages. */
  async list(collectionPath: string, pageSize = 300): Promise<TDoc[]> {
    const out: TDoc[] = [];
    let token: string | undefined;
    do {
      const q = `pageSize=${String(pageSize)}${token === undefined ? "" : `&pageToken=${encodeURIComponent(token)}`}`;
      const page = await call(
        `${this.base}/${collectionPath}?${q}`,
        { headers: await this.auth() },
        listSchema,
      );
      out.push(...(page.documents ?? []).map((d) => this.toDoc(d)));
      token = page.nextPageToken;
    } while (token !== undefined);
    return out;
  }
}

/** Field paths with characters outside [A-Za-z0-9_] must be backquoted. */
function quoteField(field: string): string {
  return field
    .split(".")
    .map((p) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : `\`${p.replace(/`/g, "\\`")}\``))
    .join(".");
}
