/** One page of the site: where its content comes from and where it is served. */
export type TPage = {
  /** URL path, `/` or `/install/`. */
  path: string;
  title: string;
  /** Repo-relative source: `.md` is rendered, `.html` is used as is. */
  source: string;
  /** Shown in the header. */
  nav?: string;
};

export const PAGES: readonly TPage[] = [
  {
    path: "/",
    title: "Agentdeck: your coding agents, in your pocket",
    source: "apps/site/content/landing.html",
  },
  { path: "/install/", title: "Install", source: "apps/site/content/install.md", nav: "Install" },
  {
    path: "/quickstart/",
    title: "Quick start",
    source: "apps/site/content/quickstart.md",
    nav: "Quick start",
  },
  { path: "/docs/guide/", title: "Guide", source: "docs/guide.md", nav: "Guide" },
  {
    path: "/docs/self-host/",
    title: "Self-host the relay",
    source: "docs/relay-deploy.md",
    nav: "Self-host",
  },
  { path: "/docs/security/", title: "Security", source: "docs/rules/security.md", nav: "Security" },
  { path: "/privacy/", title: "Privacy policy", source: "docs/privacy.md" },
  { path: "/terms/", title: "Terms of use", source: "docs/terms.md" },
];

export const REPO_URL = "https://github.com/sumeetrohra/wrktree.ai";
