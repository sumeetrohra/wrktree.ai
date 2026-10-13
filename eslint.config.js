// Strict lint for the whole monorepo. Every rule here is documented in docs/rules/ and has a
// fixture in tools/lint-fixtures/ proving it fires.
import js from "@eslint/js";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import prettier from "eslint-config-prettier";
import checkFile from "eslint-plugin-check-file";
import importX from "eslint-plugin-import-x";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import security from "eslint-plugin-security";
import globals from "globals";
import tseslint from "typescript-eslint";

// ---------------------------------------------------------------------------
// Library wrappers (docs/rules/library-calls.md): each I/O library is importable only in its zone.
// ---------------------------------------------------------------------------
const LIBRARIES = [
  { id: "L1", names: ["better-sqlite3"], zone: "sqlite" },
  { id: "L2", names: ["@agentclientprotocol/sdk"], zone: "daemon-infra-acp" },
  { id: "L3", names: ["ws"], zone: "transport" },
  { id: "L3", names: ["node:http", "http", "node:https", "https"], zone: "transport" },
  { id: "L4", names: ["node:child_process", "child_process"], zone: "process" },
  { id: "L5", names: ["@vscode/ripgrep"], zone: "daemon-infra-search" },
  { id: "L6", names: ["pino"], zone: "daemon-infra-log" },
  {
    id: "L11",
    names: ["@noble/curves", "@noble/ciphers", "@noble/hashes", "libsodium-wrappers-sumo"],
    zone: "crypto",
  },
  { id: "L12", names: ["hono", "@hono/node-server"], zone: "http-framework" },
  { id: "L13", names: ["jose"], zone: "jwt" },
  { id: "L15", names: ["cloudflare:workers"], zone: "workers" },
  { id: "L16", names: ["react-native-mmkv"], zone: "mmkv" },
  { id: "L17", names: ["expo-secure-store"], zone: "secure-store" },
  { id: "L18", names: ["expo-notifications"], zone: "notifications" },
  { id: "L20", names: ["expo-image-picker", "expo-clipboard", "expo-file-system"], zone: "media" },
  { id: "L21", names: ["expo-haptics", "expo-device"], zone: "device" },
  { id: "L22", names: ["expo-crypto"], zone: "expo-crypto" },
  { id: "L25", names: ["shiki"], zone: "highlight" },
  { id: "L26", names: ["react-native-webview"], zone: "webview" },
  { id: "L27", names: ["node-pty"], zone: "daemon-infra-pty" },
  { id: "L28", names: ["@xterm/xterm", "@xterm/addon-fit"], zone: "terminal" },
  { id: "L29", names: ["expo-speech-recognition"], zone: "speech" },
  { id: "L30", names: ["react-native-tcp-socket"], zone: "localserver" },
];

// ---------------------------------------------------------------------------
// Layers (docs/rules/structure.md). Each zone lists the import patterns it must NOT use.
// Zones are matched in order; a later zone fully replaces an earlier one for the files it covers.
// ---------------------------------------------------------------------------
const UP_TWO = {
  regex: "^\\.\\./\\.\\./",
  message: "S2: relative imports go up at most one level; use the #src/ alias.",
};
const MODULE_INTERNALS = {
  regex: "^#src/modules/[^/]+/(?!index\\.js$)",
  message: "S3: import a module only through its index.ts.",
};
const ban = (layers, why) => ({ regex: `^#src/(${layers.join("|")})/`, message: why });
const SIBLING = {
  regex: "^\\.\\./",
  message: "S4: a module never imports another module; add a port to its .types.ts.",
};

/** L24: Google/Firebase REST endpoints are called only from packages/firebase-rest. */
const FIREBASE_ENDPOINTS = [
  {
    selector: "Literal[value=/googleapis\\.com/], TemplateElement[value.raw=/googleapis\\.com/]",
    message: "L24: call Firebase through @agentdeck/firebase-rest.",
  },
];

/** TY6, SEC7: banned everywhere. */
const BASE_RESTRICTED_SYNTAX = [
  {
    selector: "CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
    message: "TY6: parse untrusted JSON with parseJson(schema, text) from @agentdeck/shared.",
  },
  {
    selector: "Property[key.name='shell'][value.value=true]",
    message: "SEC7: shell: true only in infra/process for repo setup scripts.",
  },
];

const banApp = (layers, who) => ({
  regex: `^@/(${layers.join("|")})(/|$)`,
  message: `S4: ${who} may not import ${layers.join(", ")}.`,
});

/** Imports banned everywhere in the app (R9, R10, L7, L8, L10). */
const MOBILE_PATHS = [
  {
    name: "react",
    importNames: [
      "createContext",
      "useContext",
      "useMemo",
      "useCallback",
      "memo",
      "useEffect",
      "useLayoutEffect",
    ],
    message:
      "R6/R9/R10: no Context (use Zustand), no memo hooks (React Compiler), no effects (see docs/rules/react.md).",
  },
  {
    name: "react-native",
    importNames: ["Pressable", "TextInput", "Text", "Button", "Switch"],
    message: "L10/U1: use the design-system component from @/shared/components/ui.",
  },
  { name: "dayjs", message: "L7: use @/shared/utils/datetime-utils." },
  { name: "@sentry/react-native", message: "L8: report errors through @/modules/sentry." },
];

const ZONES = [
  { name: "default", files: ["**/*.{ts,tsx}"], allow: [], patterns: [UP_TWO] },
  {
    name: "packages",
    files: ["packages/*/src/**/*.ts"],
    allow: [],
    patterns: [
      UP_TWO,
      { regex: "^@agentdeck/", message: "S1: protocol and shared depend on no other workspace package." },
    ],
  },
  {
    name: "packages-firebase-rest",
    files: ["packages/firebase-rest/src/**/*.ts"],
    allow: [],
    patterns: [
      UP_TWO,
      { regex: "^@agentdeck/(?!shared$)", message: "S1: firebase-rest depends only on shared." },
    ],
  },
  {
    name: "packages-crypto",
    files: ["packages/crypto/src/**/*.ts"],
    allow: ["crypto"],
    patterns: [UP_TWO, { regex: "^@agentdeck/(?!shared$)", message: "S1: crypto depends only on shared." }],
  },
  {
    name: "process",
    files: ["tools/**/*.ts", "e2e/**/*.ts"],
    allow: ["process", "transport"],
    patterns: [UP_TWO],
  },
  {
    name: "fake-agent",
    files: ["tools/fake-agent/src/**/*.ts"],
    allow: ["daemon-infra-acp", "process"],
    patterns: [UP_TWO],
  },

  // Daemon
  {
    name: "daemon-main",
    files: ["apps/daemon/src/main.ts"],
    allow: [],
    patterns: [UP_TWO, ban(["modules", "infra", "shared"], "S4: main.ts only starts the app.")],
  },
  {
    name: "daemon-entry",
    files: ["apps/daemon/src/index.ts"],
    allow: [],
    patterns: [UP_TWO, MODULE_INTERNALS],
  },
  {
    name: "daemon-app",
    files: ["apps/daemon/src/app/**/*.ts"],
    allow: [],
    patterns: [UP_TWO, MODULE_INTERNALS],
  },
  {
    name: "daemon-module-root",
    files: ["apps/daemon/src/modules/*/*.ts"],
    allow: [],
    patterns: [
      UP_TWO,
      SIBLING,
      ban(["app", "modules"], "S4: modules never import the app layer or other modules."),
    ],
  },
  {
    name: "daemon-module-deep",
    files: ["apps/daemon/src/modules/*/*/**/*.ts"],
    allow: [],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: modules never import the app layer or other modules.")],
  },
  {
    name: "daemon-infra",
    files: ["apps/daemon/src/infra/**/*.ts"],
    allow: [],
    patterns: [
      UP_TWO,
      ban(["app", "modules"], "S4: infra wraps the outside world and knows nothing of modules."),
    ],
  },
  {
    name: "daemon-infra-db",
    files: ["apps/daemon/src/infra/db/**/*.ts"],
    allow: ["sqlite"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "daemon-infra-acp",
    files: ["apps/daemon/src/infra/acp/**/*.ts"],
    allow: ["daemon-infra-acp"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "daemon-infra-transport",
    files: ["apps/daemon/src/infra/transport/**/*.ts"],
    allow: ["transport"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "daemon-infra-relay",
    files: ["apps/daemon/src/infra/relay/**/*.ts"],
    allow: ["transport"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "daemon-infra-process",
    files: ["apps/daemon/src/infra/process/**/*.ts"],
    allow: ["process"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "daemon-infra-pty",
    files: ["apps/daemon/src/infra/pty/**/*.ts"],
    allow: ["daemon-infra-pty"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "daemon-infra-search",
    files: ["apps/daemon/src/infra/search/**/*.ts"],
    allow: ["daemon-infra-search"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "daemon-infra-log",
    files: ["apps/daemon/src/infra/log/**/*.ts"],
    allow: ["daemon-infra-log"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "daemon-shared",
    files: ["apps/daemon/src/shared/**/*.ts"],
    allow: [],
    patterns: [
      UP_TWO,
      { regex: "^\\.\\./", message: "S4: shared is flat." },
      ban(["app", "modules", "infra"], "S4: shared depends on nothing else in the daemon."),
    ],
  },

  // Relay (apps/relay): same layering as the daemon. Hosts (node, worker) live in infra and app.
  {
    name: "relay-entry",
    files: ["apps/relay/src/*.ts"],
    allow: [],
    patterns: [UP_TWO, MODULE_INTERNALS],
  },
  {
    name: "relay-tests",
    files: ["apps/relay/src/*.test.ts"],
    allow: ["process"],
    patterns: [UP_TWO, MODULE_INTERNALS],
  },
  {
    name: "relay-app",
    files: ["apps/relay/src/app/**/*.ts"],
    allow: ["http-framework", "workers"],
    patterns: [UP_TWO, MODULE_INTERNALS],
  },
  {
    name: "relay-module-root",
    files: ["apps/relay/src/modules/*/*.ts"],
    allow: [],
    patterns: [
      UP_TWO,
      SIBLING,
      ban(["app", "modules", "infra"], "S4: relay modules use ports, never infra or other modules."),
    ],
  },
  {
    name: "relay-module-tests",
    files: ["apps/relay/src/modules/*/*.test.ts"],
    allow: [],
    patterns: [
      UP_TWO,
      SIBLING,
      ban(["app", "modules"], "S4: tests may build real infra, never other modules."),
    ],
  },
  {
    name: "relay-infra",
    files: ["apps/relay/src/infra/**/*.ts"],
    allow: [],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "relay-infra-node",
    files: ["apps/relay/src/infra/node/**/*.ts"],
    allow: ["transport", "http-framework"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "relay-infra-sql",
    files: ["apps/relay/src/infra/sql/**/*.ts"],
    allow: ["sqlite"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "relay-infra-idtoken",
    files: ["apps/relay/src/infra/idtoken/**/*.ts"],
    allow: ["jwt"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "relay-infra-worker",
    files: ["apps/relay/src/infra/worker/**/*.ts"],
    allow: ["workers"],
    patterns: [UP_TWO, ban(["app", "modules"], "S4: infra knows nothing of modules.")],
  },
  {
    name: "relay-shared",
    files: ["apps/relay/src/shared/**/*.ts"],
    allow: [],
    patterns: [
      UP_TWO,
      { regex: "^\\.\\./", message: "S4: shared is flat." },
      ban(["app", "modules", "infra"], "S4: shared depends on nothing else in the relay."),
    ],
  },

  // CLI
  { name: "cli-commands", files: ["apps/cli/src/commands/**/*.ts"], allow: [], patterns: [UP_TWO] },
  {
    name: "cli-lib",
    files: ["apps/cli/src/lib/**/*.ts"],
    allow: [],
    patterns: [UP_TWO, ban(["commands"], "S4: lib never imports commands.")],
  },
  {
    name: "cli-lib-client",
    files: ["apps/cli/src/lib/daemon-client/**/*.ts"],
    allow: ["transport"],
    patterns: [UP_TWO, ban(["commands"], "S4: lib never imports commands.")],
  },
  {
    name: "cli-lib-process",
    files: ["apps/cli/src/lib/process/**/*.ts"],
    allow: ["process"],
    patterns: [UP_TWO, ban(["commands"], "S4: lib never imports commands.")],
  },
  {
    name: "cli-shared",
    files: ["apps/cli/src/shared/**/*.ts"],
    allow: [],
    patterns: [UP_TWO, ban(["commands", "lib"], "S4: shared depends on nothing else in the CLI.")],
  },

  // App (apps/mobile): routes -> pages -> modules -> lib/shared. See docs/rules/structure.md.
  {
    name: "mobile",
    files: ["apps/mobile/src/**/*.{ts,tsx}"],
    allow: [],
    paths: MOBILE_PATHS,
    patterns: [UP_TWO],
  },
  {
    name: "mobile-routes",
    files: ["apps/mobile/src/app/**/*.tsx"],
    allow: [],
    paths: MOBILE_PATHS,
    patterns: [
      UP_TWO,
      {
        regex: "^(?!@/(pages|providers)(/|$))",
        message: "S6: route files only re-export a page or the root layout.",
      },
    ],
  },
  {
    name: "mobile-pages",
    files: ["apps/mobile/src/pages/**/*.{ts,tsx}"],
    allow: [],
    paths: MOBILE_PATHS,
    patterns: [
      UP_TWO,
      { regex: "^@/modules/[^/]+/.", message: "S3: import a module only through its index.ts." },
      banApp(["app"], "pages"),
    ],
  },
  {
    name: "mobile-modules",
    files: ["apps/mobile/src/modules/**/*.{ts,tsx}"],
    allow: [],
    paths: MOBILE_PATHS,
    patterns: [
      UP_TWO,
      banApp(
        ["modules", "pages", "app", "providers"],
        "modules (use relative imports inside your own module)",
      ),
    ],
  },
  {
    name: "mobile-sentry",
    files: ["apps/mobile/src/modules/sentry/**/*.ts"],
    allow: [],
    paths: MOBILE_PATHS.filter((x) => x.name !== "@sentry/react-native"),
    patterns: [UP_TWO, banApp(["modules", "pages", "app", "providers"], "modules")],
  },
  {
    name: "mobile-lib",
    files: ["apps/mobile/src/lib/**/*.{ts,tsx}"],
    allow: [],
    paths: MOBILE_PATHS,
    patterns: [UP_TWO, banApp(["modules", "pages", "app", "providers"], "lib")],
  },
  // One wrapper folder per native library (L16–L22).
  ...[
    ["storage", "mmkv"],
    ["secure-store", "secure-store"],
    ["highlight", "highlight"],
    ["webview", "webview"],
    ["notifications", "notifications"],
    ["media", "media"],
    ["speech", "speech"],
    ["localserver", "localserver"],
    ["device", "device"],
    ["api", "expo-crypto"],
  ].map(([folder, tag]) => ({
    name: `mobile-lib-${folder}`,
    files: [`apps/mobile/src/lib/${folder}/**/*.{ts,tsx}`],
    allow: [tag],
    paths: MOBILE_PATHS,
    patterns: [UP_TWO, banApp(["modules", "pages", "app", "providers"], "lib")],
  })),
  // The terminal view: xterm.js on the web, xterm.js in a WebView on phones (L26, L28).
  {
    name: "mobile-lib-terminal",
    files: ["apps/mobile/src/lib/terminal/**/*.{ts,tsx}"],
    allow: ["terminal", "webview"],
    paths: MOBILE_PATHS,
    patterns: [UP_TWO, banApp(["modules", "pages", "app", "providers"], "lib")],
  },
  {
    name: "mobile-providers",
    files: ["apps/mobile/src/providers/**/*.{ts,tsx}"],
    allow: [],
    paths: MOBILE_PATHS,
    patterns: [UP_TWO, banApp(["modules", "pages", "app"], "providers")],
  },
  {
    name: "mobile-shared",
    files: ["apps/mobile/src/shared/**/*.{ts,tsx}"],
    allow: [],
    paths: MOBILE_PATHS,
    patterns: [UP_TWO, banApp(["modules", "pages", "app", "providers", "lib"], "shared")],
  },
  {
    name: "mobile-datetime",
    files: ["apps/mobile/src/shared/utils/datetime-utils.ts"],
    allow: [],
    paths: MOBILE_PATHS.filter((x) => x.name !== "dayjs" && !x.name.startsWith("dayjs/")),
    patterns: [UP_TWO],
  },
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function restrictedImports(zone) {
  const banned = LIBRARIES.filter((l) => !zone.allow.includes(l.zone));
  const message = (l, name) =>
    `${l.id}: ${name} may only be imported in its wrapper (docs/rules/library-calls.md).`;
  const paths = banned.flatMap((l) => l.names.map((name) => ({ name, message: message(l, name) })));
  // Subpath imports (`@noble/ciphers/chacha.js`, `dayjs/plugin/…`) are the same library.
  const subpaths = banned.flatMap((l) =>
    l.names.map((name) => ({ regex: `^${escapeRegex(name)}/`, message: message(l, name) })),
  );
  return ["error", { paths: [...paths, ...(zone.paths ?? [])], patterns: [...zone.patterns, ...subpaths] }];
}

/** N1–N5 (docs/rules/naming.md). */
const NAMING_CONVENTION = [
  "error",
  { selector: "typeAlias", format: ["PascalCase"], prefix: ["T"] },
  { selector: "interface", format: ["PascalCase"], prefix: ["I"] },
  { selector: "enum", format: ["PascalCase"], prefix: ["E"] },
  { selector: "enumMember", format: ["UPPER_CASE"] },
  { selector: "typeParameter", format: ["PascalCase"] },
  { selector: "class", format: ["PascalCase"] },
  {
    selector: "variable",
    format: ["camelCase", "UPPER_CASE", "PascalCase"],
    leadingUnderscore: "allow",
  },
  { selector: "function", format: ["camelCase", "PascalCase"] },
];

const zoneConfigs = ZONES.map((zone) => ({
  name: `zone/${zone.name}`,
  files: zone.files,
  rules: { "no-restricted-imports": restrictedImports(zone) },
}));

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "artifacts/**",
      "**/.turbo/**",
      "tools/lint-fixtures/fixtures/**",
      // Test data: a plain Node script standing in for ffmpeg, run as a program.
      "e2e/fixtures/**",
      "apps/mobile/src/shared/components/ui/**",
      "apps/mobile/.expo/**",
      "**/.wrangler/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  comments.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*/*/vitest.config.ts", "e2e/vitest.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: { "import-x": importX, "check-file": checkFile, security },
    settings: { "import-x/internal-regex": "^(#src|@)/" },
    rules: {
      // Golden rules
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description" }],
      "@typescript-eslint/only-throw-error": "error",
      "import-x/no-default-export": "error",
      "@eslint-community/eslint-comments/require-description": ["error", { ignore: [] }],
      "@eslint-community/eslint-comments/no-unused-disable": "error",

      // Typing
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      // TY8 (type for shapes, interface for ports) is a review rule; both forms are allowed.
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "no-restricted-syntax": ["error", ...BASE_RESTRICTED_SYNTAX, ...FIREBASE_ENDPOINTS],

      // Naming (docs/rules/naming.md)
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
      "check-file/filename-naming-convention": [
        "error",
        { "**/*.{ts,tsx,js}": "KEBAB_CASE" },
        { ignoreMiddleExtensions: true },
      ],
      "check-file/folder-naming-convention": [
        "error",
        {
          "{apps/{daemon,cli,relay},packages/*,tools/*}/src/**/": "KEBAB_CASE",
          "apps/mobile/src/!(app)/**/": "KEBAB_CASE",
          "e2e/{src,record}/**/": "KEBAB_CASE",
        },
      ],

      // Imports
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", ["sibling", "index"]],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],

      // Security (selected; the noisy object-injection / fs-filename rules stay off)
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-require": "error",
      "security/detect-new-buffer": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-unsafe-regex": "error",
      "security/detect-buffer-noassert": "error",
    },
  },
  ...zoneConfigs,
  {
    name: "mobile",
    files: ["apps/mobile/src/**/*.{ts,tsx}"],
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "19.2" } },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/purity": "error",
      "react-hooks/refs": "error",
      "react-hooks/immutability": "error",
      "react-hooks/set-state-in-render": "error",
      "react-hooks/static-components": "error",
      "react-hooks/globals": "error",
      "react-hooks/error-boundaries": "error",
      "react/no-multi-comp": ["error", { ignoreStateless: false }],
      "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true }],
      "no-restricted-syntax": [
        "error",
        ...BASE_RESTRICTED_SYNTAX,
        ...FIREBASE_ENDPOINTS,
        {
          selector:
            "CallExpression[callee.name=/^use(Layout)?Effect$/], CallExpression[callee.property.name=/^use(Layout)?Effect$/]",
          message:
            "R6: no effects. Use React Query, Zustand, event handlers or derived values (docs/rules/react.md).",
        },
        { selector: "NewExpression[callee.name='Date']", message: "I2: use @/shared/utils/datetime-utils." },
        {
          selector: "Literal[value=/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message: "U4: no hex colours; use semantic theme tokens.",
        },
        {
          selector:
            "Literal[value=/(^|\\s)(text|bg|border|ring|fill|stroke)-(red|blue|green|gray|slate|zinc|neutral|stone|orange|amber|yellow|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|black|white)(-[0-9]+)?(\\s|$)/]",
          message:
            "U4: no raw Tailwind palette colours; use semantic tokens (bg-background, text-foreground…).",
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "WebSocket", message: "L9/A1: only src/lib/api talks to the daemon." },
        { name: "fetch", message: "L9/A1: only src/lib/api talks to the daemon." },
      ],
    },
  },
  {
    name: "mobile-api",
    files: ["apps/mobile/src/lib/api/**/*.ts"],
    rules: { "no-restricted-globals": "off" },
  },
  {
    // L23: sign-in (Firebase Auth REST, the relay's dev issuer) is the only other network caller.
    name: "mobile-auth",
    files: ["apps/mobile/src/lib/auth/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "WebSocket", message: "L9/A1: only src/lib/api talks to the daemon." },
      ],
    },
  },
  {
    name: "mobile-routes-files",
    files: ["apps/mobile/src/app/**/*.tsx"],
    rules: { "import-x/no-default-export": "off", "check-file/filename-naming-convention": "off" },
  },
  {
    name: "commonjs-config",
    files: ["apps/mobile/*.js"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // L24: the Firebase REST wrapper, and the relay's verifier of Google-signed ID tokens.
    name: "firebase-endpoints",
    files: ["packages/firebase-rest/src/**/*.ts", "apps/relay/src/infra/idtoken/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", ...BASE_RESTRICTED_SYNTAX] },
  },
  {
    name: "tests",
    files: ["**/*.test.ts", "**/*.test.tsx", "e2e/**/*.ts"],
    rules: {
      // T7: fixtures and assertions may use these; nothing else relaxes.
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // Tests parse their own fixture JSON and drive child processes directly.
      "no-restricted-syntax": "off",
    },
  },
  {
    name: "config-files",
    files: ["**/*.config.{js,ts,mjs}", "eslint.config.js"],
    rules: { "import-x/no-default-export": "off" },
  },
  {
    // Workers find their handler through the module's default export.
    name: "worker-entry",
    files: ["apps/relay/src/main.worker.ts"],
    rules: { "import-x/no-default-export": "off" },
  },
  {
    name: "plain-js",
    files: ["**/*.{js,mjs}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { ...globals.node, ...globals.browser },
    },
  },
  prettier,
);
