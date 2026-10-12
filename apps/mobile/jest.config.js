/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.css$": "<rootDir>/jest.css-stub.js",
    // Jest resolves the "react-native" condition to lucide's .mjs build, which it can't load.
    "^lucide-react-native$": "<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js",
  },
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  transformIgnorePatterns: [
    // pnpm: skip the `.pnpm` store segment, then transform these packages (they ship JSX/ESM).
    "node_modules/(?!(\\.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-.*|react-navigation|@react-navigation/.*|@rn-primitives/.*|lucide-react-native|nativewind|react-native-css-interop|@agentdeck/.*|@noble/.*|standard-navigation|@shopify/flash-list|ulid))",
  ],
};
