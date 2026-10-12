import { Firestore, Storage } from "@agentdeck/firebase-rest";

import type { ICloudStore } from "#src/modules/cloud/index.js";

import type { Remote } from "./remote.service.js";

/**
 * The cloud store for whoever is signed in on this host: Firestore and Storage with the
 * account's ID tokens, or null when the host isn't signed in with Firebase.
 */
export function cloudStoreFor(remote: Remote): () => Promise<ICloudStore | null> {
  let cached: { key: string; store: ICloudStore } | null = null;
  return async () => {
    const access = await remote.cloudAccess().catch(() => null);
    if (!access) {
      cached = null;
      return null;
    }
    const key = `${access.uid}/${access.hostId}`;
    if (cached?.key === key) return cached.store;
    const idToken = (): Promise<string> => access.tokens.idToken();
    const db = new Firestore(access.config, idToken);
    const files = new Storage(access.config, idToken);
    const store: ICloudStore = {
      uid: access.uid,
      hostId: access.hostId,
      hostName: remote.hostName,
      commit: (writes) => db.commit(writes),
      upload: (path, bytes, mime) => files.upload(path, bytes, mime),
      exists: (path) => files.exists(path),
    };
    cached = { key, store };
    return store;
  };
}
