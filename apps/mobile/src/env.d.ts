/**
 * The app's build-time environment. Expo inlines `process.env.EXPO_PUBLIC_*` only when read with
 * dot access, so every variable is declared here (and validated with zod where it is read).
 */
declare namespace NodeJS {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- reason: augments Node's own ProcessEnv interface, whose name is fixed
  interface ProcessEnv {
    EXPO_PUBLIC_DAEMON_URL?: string;
    EXPO_PUBLIC_DAEMON_TOKEN?: string;
  }
}
