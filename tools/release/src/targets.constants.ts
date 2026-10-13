/** One package that goes to npm, built from a workspace package. */
export type TTarget = {
  /** The npm name. */
  name: string;
  /** The workspace package it is built from (its version is the release's). */
  from: string;
  description: string;
  /** Entry files bundled with every `@agentdeck/*` import inlined; npm dependencies stay external. */
  bundle: { entry: string; out: string }[];
  bin?: Record<string, string>;
  /** Published as built (no bundling): copy these folders. */
  copy?: string[];
  exports?: Record<string, unknown>;
  /** A folder to ship next to the bundle, if it exists (the web app for the desktop UI). */
  extra?: { from: string; to: string };
};

export const TARGETS: readonly TTarget[] = [
  {
    name: "agentdeck",
    from: "apps/cli",
    description: "Drive coding agents (Claude Code, Codex, Gemini) on your computers from your phone.",
    bundle: [{ entry: "apps/cli/dist/main.js", out: "dist/agentdeck.js" }],
    bin: { agentdeck: "./dist/agentdeck.js" },
    extra: { from: "apps/mobile/dist", to: "dist/web" },
  },
  {
    name: "@agentdeck/relay",
    from: "apps/relay",
    description:
      "The Agentdeck relay, to self-host: routes end-to-end encrypted frames between your devices.",
    bundle: [{ entry: "apps/relay/dist/main.node.js", out: "dist/relay.js" }],
    bin: { "agentdeck-relay": "./dist/relay.js" },
  },
  {
    name: "@agentdeck/protocol",
    from: "packages/protocol",
    description: "The Agentdeck protocol: zod schemas for the daemon's commands, events and the relay API.",
    bundle: [],
    copy: ["dist"],
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
  },
];
