// Strict lint for the whole monorepo. Every rule here is documented in docs/rules/ and has a
// fixture in tools/lint-fixtures/ proving it fires.
import js from "@eslint/js";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import prettier from "eslint-config-prettier";
import checkFile from "eslint-plugin-check-file";
import importX from "eslint-plugin-import-x";
import security from "eslint-plugin-security";
import globals from "globals";
import tseslint from "typescript-eslint";

// ---------------------------------------------------------------------------
// Library wrappers (docs/rules/library-calls.md): each I/O library is importable only in its zone.
// ---------------------------------------------------------------------------
const LIBRARIES = [
  { id: "L1", names: ["better-sqlite3"], zone: "daemon-infra-db" },
  { id: "L2", names: ["@agentclientprotocol/sdk"], zone: "daemon-infra-acp" },
  { id: "L3", names: ["ws"], zone: "transport" },
  { id: "L3", names: ["node:http", "http", "node:https", "https"], zone: "transport" },
  { id: "L4", names: ["node:child_process", "child_process"], zone: "process" },
  { id: "L5", names: ["@vscode/ripgrep"], zone: "daemon-infra-search" },
  { id: "L6", names: ["pino"], zone: "daemon-infra-log" },
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
    allow: ["daemon-infra-db"],
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
    name: "daemon-infra-process",
    files: ["apps/daemon/src/infra/process/**/*.ts"],
    allow: ["process"],
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
];

function restrictedImports(zone) {
  const paths = LIBRARIES.filter((l) => !zone.allow.includes(l.zone)).flatMap((l) =>
    l.names.map((name) => ({
      name,
      message: `${l.id}: ${name} may only be imported in its wrapper (docs/rules/library-calls.md).`,
    })),
  );
  return ["error", { paths, patterns: zone.patterns }];
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
      "apps/mobile/src/shared/components/ui/**",
      "apps/mobile/.expo/**",
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
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
          message: "TY6: parse untrusted JSON with parseJson(schema, text) from @agentdeck/shared.",
        },
        {
          selector: "Property[key.name='shell'][value.value=true]",
          message: "SEC7: shell: true only in infra/process for repo setup scripts.",
        },
      ],

      // Naming (docs/rules/naming.md)
      "@typescript-eslint/naming-convention": NAMING_CONVENTION,
      "check-file/filename-naming-convention": [
        "error",
        { "**/*.{ts,tsx,js}": "KEBAB_CASE" },
        { ignoreMiddleExtensions: true },
      ],
      "check-file/folder-naming-convention": [
        "error",
        { "{apps,packages,tools}/*/src/**/": "KEBAB_CASE", "e2e/{src,record}/**/": "KEBAB_CASE" },
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
