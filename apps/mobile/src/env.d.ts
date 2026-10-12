/**
 * The app's build-time environment. Expo inlines `process.env.EXPO_PUBLIC_*` only when read with
 * dot access, so every variable is declared here (and validated with zod where it is read).
 */
declare namespace NodeJS {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- reason: augments Node's own ProcessEnv interface, whose name is fixed
  interface ProcessEnv {
    EXPO_PUBLIC_DAEMON_URL?: string;
    EXPO_PUBLIC_DAEMON_TOKEN?: string;
    /** Firebase Web API key: enables email-link sign-in. */
    EXPO_PUBLIC_FIREBASE_API_KEY?: string;
    /** "1": offer sign-in through the relay's dev issuer (tests, local work). */
    EXPO_PUBLIC_DEV_AUTH?: string;
    /** The relay this build points at by default. */
    EXPO_PUBLIC_RELAY_URL?: string;
    /** Where the web app lives (email sign-in links come back to it). */
    EXPO_PUBLIC_APP_URL?: string;
  }
}
