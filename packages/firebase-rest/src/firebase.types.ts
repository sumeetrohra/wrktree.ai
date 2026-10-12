/**
 * A Firebase project as clients see it. Every field is public (it ships inside the app); the
 * relay serves it at `GET /v1/config`. `emulators` points every service at the local Emulator
 * Suite (development and tests only).
 */
export type TFirebaseConfig = {
  apiKey: string;
  projectId: string;
  storageBucket: string;
  emulators?:
    { auth?: string | undefined; firestore?: string | undefined; storage?: string | undefined } | undefined;
};

/** A signed-in user: who, and the long-lived refresh token that mints ID tokens. */
export type TFirebaseSession = { uid: string; email: string | null; refreshToken: string };

/** Firebase refused a request; `reason` is its error message (e.g. INVALID_OOB_CODE). */
export class FirebaseError extends Error {
  override name = "FirebaseError";

  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`firebase ${String(status)}: ${reason}`);
  }
}
