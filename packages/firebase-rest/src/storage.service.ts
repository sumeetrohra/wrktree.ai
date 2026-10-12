import { z } from "zod";

import { FirebaseError, type TFirebaseConfig } from "./firebase.types.js";
import { call } from "./http.utils.js";

const objectSchema = z.looseObject({ name: z.string() });

/** Cloud Storage for Firebase over its REST API, with the signed-in user's ID token. */
export class Storage {
  constructor(
    private readonly cfg: TFirebaseConfig,
    private readonly idToken: () => Promise<string>,
  ) {}

  private get base(): string {
    const host = this.cfg.emulators?.storage;
    const origin = host === undefined ? "https://firebasestorage.googleapis.com" : `http://${host}`;
    return `${origin}/v0/b/${encodeURIComponent(this.cfg.storageBucket)}/o`;
  }

  /** Uploads (or replaces) the object at `path`. */
  async upload(path: string, bytes: Uint8Array, mime: string): Promise<void> {
    await call(
      `${this.base}?name=${encodeURIComponent(path)}`,
      {
        method: "POST",
        headers: {
          authorization: `Firebase ${await this.idToken()}`,
          "content-type": mime,
          "x-goog-upload-protocol": "raw",
        },
        body: bytes,
      },
      objectSchema,
    );
  }

  /** The object's bytes. Throws a 404 `FirebaseError` when it doesn't exist. */
  async download(path: string): Promise<Uint8Array> {
    const res = await fetch(`${this.base}/${encodeURIComponent(path)}?alt=media`, {
      headers: { authorization: `Firebase ${await this.idToken()}` },
    });
    if (!res.ok) throw new FirebaseError(res.status, `download failed for ${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Whether the object exists (uploads are skipped when it does). */
  async exists(path: string): Promise<boolean> {
    const res = await fetch(`${this.base}/${encodeURIComponent(path)}`, {
      headers: { authorization: `Firebase ${await this.idToken()}` },
    });
    return res.ok;
  }
}
