/** How the daemon launches and manages one kind of ACP agent. */
export type TAgentSpec = {
  id: string;
  displayName: string;
  /** Adapter command line; the daemon talks ACP to it over stdio. */
  command: readonly string[];
  /** Env that points the agent at a profile's isolated config folder. */
  profileEnv: (dir: string) => Record<string, string>;
  /** Run in a desktop terminal with `profileEnv` applied. */
  loginCommand: readonly string[];
  loginStatus: (dir: string) => TLoginStatus;
  /** Recognises a usage-limit failure in an adapter error. */
  detectLimit: (err: unknown) => TLimitCheck;
};

export type TLoginStatus = { loggedIn: boolean; account?: string };
export type TLimitCheck = { hit: boolean; resetAt?: number };
