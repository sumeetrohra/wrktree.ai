import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // `#src/x.js` → `src/x.ts`, mirroring the package's `imports` map for the TypeScript sources.
    alias: [
      { find: /^#src\/(.*)\.js$/, replacement: fileURLToPath(new URL("./src/$1.ts", import.meta.url)) },
    ],
  },
});
