import { describe, expect, it } from "vitest";

import { FirebaseAuth, oobCodeOf } from "./auth.service.js";
import type { TFirebaseConfig } from "./firebase.types.js";
import { decodeValue, encodeValue, type TJson } from "./firestore-value.utils.js";
import { Firestore } from "./firestore.service.js";
import { Storage } from "./storage.service.js";

describe("Firestore values", () => {
  it("round-trips JSON data", () => {
    const v: TJson = { a: 1, b: 1.5, c: "x", d: [true, null, { e: [] }], f: {} };
    expect(decodeValue(encodeValue(v))).toEqual(v);
    expect(encodeValue(3)).toEqual({ integerValue: "3" });
  });
});

describe("sign-in links", () => {
  it("finds the oobCode, also inside a nested link", () => {
    expect(oobCodeOf("https://app/sign-in?mode=signIn&oobCode=abc")).toBe("abc");
    const nested = `https://x.page.link/?link=${encodeURIComponent("https://p.firebaseapp.com/__/auth/action?oobCode=xyz")}`;
    expect(oobCodeOf(nested)).toBe("xyz");
    expect(oobCodeOf("not a url")).toBeNull();
  });
});

// Against the Firebase Emulator Suite: `pnpm emulators "pnpm --filter @agentdeck/firebase-rest test"`.
const hosts = {
  auth: process.env["FIREBASE_AUTH_EMULATOR_HOST"],
  firestore: process.env["FIRESTORE_EMULATOR_HOST"],
  storage: process.env["FIREBASE_STORAGE_EMULATOR_HOST"],
};
const withEmulators =
  hosts.auth !== undefined && hosts.firestore !== undefined && hosts.storage !== undefined;

describe.runIf(withEmulators)("against the emulators", () => {
  const cfg: TFirebaseConfig = {
    apiKey: "fake-api-key",
    projectId: "demo-agentdeck",
    storageBucket: "demo-agentdeck.appspot.com",
    emulators: { auth: hosts.auth, firestore: hosts.firestore, storage: hosts.storage },
  };
  const auth = new FirebaseAuth(cfg);
  const signIn = async (email: string) =>
    auth.signInWithEmailLink(email, await auth.emulatorSignInLink(email));

  it("signs in with an email link and refreshes", async () => {
    const r = await signIn("me@example.com");
    expect(r.session.email).toBe("me@example.com");
    const again = await auth.refresh(r.session.refreshToken);
    expect(again.idToken.length).toBeGreaterThan(10);
  });

  it("writes, merges, queries and reads documents; rules keep other users out", async () => {
    const me = await signIn("writer@example.com");
    const db = new Firestore(cfg, () => Promise.resolve(me.idToken));
    const base = `users/${me.session.uid}`;
    await db.commit([
      { kind: "set", path: `${base}/chats/c1`, data: { title: "One", worktreeKey: "w1", at: 1 } },
      { kind: "set", path: `${base}/chats/c2`, data: { title: "Two", worktreeKey: "w2", at: 2 } },
      { kind: "merge", path: `${base}/chats/c1`, data: { status: "idle" } },
    ]);
    expect((await db.get(`${base}/chats/c1`))?.data).toEqual({
      title: "One",
      worktreeKey: "w1",
      at: 1,
      status: "idle",
    });
    const w1 = await db.query(`${base}/chats`, {
      where: [{ field: "worktreeKey", op: "EQUAL", value: "w1" }],
    });
    expect(w1.map((d) => d.path)).toEqual([`${base}/chats/c1`]);
    expect((await db.list(`${base}/chats`)).length).toBe(2);
    expect(await db.get(`${base}/chats/nope`)).toBeNull();

    const other = await signIn("other@example.com");
    const otherDb = new Firestore(cfg, () => Promise.resolve(other.idToken));
    await expect(otherDb.get(`${base}/chats/c1`)).rejects.toThrow();
    await expect(otherDb.commit([{ kind: "set", path: `${base}/chats/x`, data: {} }])).rejects.toThrow(/403/);
  });

  it("uploads and downloads files; rules keep other users out", async () => {
    const me = await signIn("files@example.com");
    const store = new Storage(cfg, () => Promise.resolve(me.idToken));
    const path = `users/${me.session.uid}/blobs/b1`;
    expect(await store.exists(path)).toBe(false);
    await store.upload(path, new Uint8Array([1, 2, 3]), "application/octet-stream");
    expect(await store.exists(path)).toBe(true);
    expect([...(await store.download(path))]).toEqual([1, 2, 3]);
    const other = await signIn("thief@example.com");
    await expect(new Storage(cfg, () => Promise.resolve(other.idToken)).download(path)).rejects.toThrow(
      /403/,
    );
  });
});
