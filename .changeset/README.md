# Changesets

Every change a user would notice gets a changeset: `pnpm changeset`, pick the bump, write one
line for the changelog. The CLI (`agentdeck` on npm), the relay and the protocol share one
version (`fixed`). The workspace packages stay private: `.github/workflows/release.yml` bumps the
versions, then `pnpm release publish` builds the npm packages (`tools/release`) and publishes
the versions npm doesn't have yet, with provenance.
