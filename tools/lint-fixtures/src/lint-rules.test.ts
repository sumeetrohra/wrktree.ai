import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const ruleEntrySchema = z
  .tuple([z.union([z.enum(["error", "warn", "off"]), z.literal(0), z.literal(1), z.literal(2)])])
  .rest(z.unknown());

/** The naming rule as the real config resolves it for a real source file. */
async function namingRule(): Promise<z.infer<typeof ruleEntrySchema>> {
  const config: unknown = await new ESLint({ cwd: ROOT }).calculateConfigForFile(
    `${ROOT}apps/daemon/src/shared/paths.utils.ts`,
  );
  const rules = z.object({ rules: z.record(z.string(), z.unknown()) }).parse(config).rules;
  return ruleEntrySchema.parse(rules["@typescript-eslint/naming-convention"]);
}

/**
 * Lints virtual files (they don't exist on disk) with the repo's real config. Type-aware rules
 * are switched off because virtual files are outside every tsconfig; the rules proven here are
 * the syntactic and path-based ones, which are exactly the structural rules that can silently rot.
 */
const eslint = new ESLint({
  cwd: ROOT,
  overrideConfig: [
    {
      files: ["**/*.{ts,tsx}"],
      ...tseslint.configs.disableTypeChecked,
      languageOptions: { parserOptions: { projectService: false, project: null } },
      rules: {
        ...tseslint.configs.disableTypeChecked.rules,
        // disableTypeChecked turns this off too; it doesn't need types for our options.
        "@typescript-eslint/naming-convention": await namingRule(),
      },
    },
  ],
});

type TCase = { rule: string; id: string; file: string; code: string };

const CASES: TCase[] = [
  // Structure (docs/rules/structure.md)
  {
    id: "S4 module imports another module",
    rule: "no-restricted-imports",
    file: "apps/daemon/src/modules/repos/bad.ts",
    code: 'import { WorktreesService } from "../worktrees/index.js";\nexport const x = WorktreesService;\n',
  },
  {
    id: "S4 module imports another module by alias",
    rule: "no-restricted-imports",
    file: "apps/daemon/src/modules/repos/bad.ts",
    code: 'import { WorktreesService } from "#src/modules/worktrees/index.js";\nexport const x = WorktreesService;\n',
  },
  {
    id: "S3 app imports module internals",
    rule: "no-restricted-imports",
    file: "apps/daemon/src/app/bad.ts",
    code: 'import { ReposService } from "#src/modules/repos/repos.service.js";\nexport const x = ReposService;\n',
  },
  {
    id: "S2 relative import two levels up",
    rule: "no-restricted-imports",
    file: "apps/daemon/src/modules/repos/sub/bad.ts",
    code: 'import { x } from "../../other/x.js";\nexport const y = x;\n',
  },
  {
    id: "S4 infra imports a module",
    rule: "no-restricted-imports",
    file: "apps/daemon/src/infra/db/bad.ts",
    code: 'import { ReposService } from "#src/modules/repos/index.js";\nexport const x = ReposService;\n',
  },
  {
    id: "S4 shared imports infra",
    rule: "no-restricted-imports",
    file: "apps/daemon/src/shared/bad.utils.ts",
    code: 'import { openDb } from "#src/infra/db/index.js";\nexport const x = openDb;\n',
  },
  {
    id: "S4 relay module imports another module",
    rule: "no-restricted-imports",
    file: "apps/relay/src/modules/hub/bad.ts",
    code: 'import { DirectoryService } from "#src/modules/directory/index.js";\nexport const x = DirectoryService;\n',
  },
  {
    id: "S4 relay module imports infra",
    rule: "no-restricted-imports",
    file: "apps/relay/src/modules/hub/bad.ts",
    code: 'import { openSql } from "#src/infra/sql/index.js";\nexport const x = openSql;\n',
  },
  {
    id: "L1 better-sqlite3 in the relay outside infra/sql",
    rule: "no-restricted-imports",
    file: "apps/relay/src/infra/node/bad.ts",
    code: 'import Database from "better-sqlite3";\nexport const x = Database;\n',
  },
  {
    id: "S1 crypto imports protocol",
    rule: "no-restricted-imports",
    file: "packages/crypto/src/bad.utils.ts",
    code: 'import { commands } from "@agentdeck/protocol";\nexport const x = commands;\n',
  },
  {
    id: "S1 protocol imports a workspace package",
    rule: "no-restricted-imports",
    file: "packages/protocol/src/bad.schema.ts",
    code: 'import { newId } from "@agentdeck/shared";\nexport const x = newId;\n',
  },
  {
    id: "S4 CLI lib imports commands",
    rule: "no-restricted-imports",
    file: "apps/cli/src/lib/daemon-client/bad.ts",
    code: 'import { HELP } from "#src/commands/help.constants.js";\nexport const x = HELP;\n',
  },

  // Library wrappers (docs/rules/library-calls.md)
  ...[
    ["L1", "better-sqlite3"],
    ["L2", "@agentclientprotocol/sdk"],
    ["L3", "ws"],
    ["L3", "node:http"],
    ["L4", "node:child_process"],
    ["L5", "@vscode/ripgrep"],
    ["L6", "pino"],
    ["L11", "@noble/ciphers/chacha.js"],
    ["L12", "hono"],
    ["L13", "jose"],
    ["L15", "cloudflare:workers"],
  ].map(([id, lib]) => ({
    id: `${id ?? ""} ${lib ?? ""} outside its wrapper`,
    rule: "no-restricted-imports",
    file: "apps/daemon/src/modules/repos/bad.ts",
    code: `import * as lib from "${lib ?? ""}";\nexport const x = lib;\n`,
  })),

  // Golden rules and typing
  {
    id: "G1 any",
    rule: "@typescript-eslint/no-explicit-any",
    file: "apps/daemon/src/shared/bad.utils.ts",
    code: "export const x: any = 1;\n",
  },
  {
    id: "G2 non-null assertion",
    rule: "@typescript-eslint/no-non-null-assertion",
    file: "apps/daemon/src/shared/bad.utils.ts",
    code: "export const f = (a: { b?: number }): number => a.b!;\n",
  },
  {
    id: "G3 type assertion",
    rule: "@typescript-eslint/consistent-type-assertions",
    file: "apps/daemon/src/shared/bad.utils.ts",
    code: "export const f = (a: unknown): string => a as string;\n",
  },
  {
    id: "G4 console",
    rule: "no-console",
    file: "apps/daemon/src/shared/bad.utils.ts",
    code: 'console.log("hi");\n',
  },
  {
    id: "G5 default export",
    rule: "import-x/no-default-export",
    file: "apps/daemon/src/shared/bad.utils.ts",
    code: "export default function f(): number {\n  return 1;\n}\n",
  },
  {
    id: "G12 ts-ignore",
    rule: "@typescript-eslint/ban-ts-comment",
    file: "apps/daemon/src/shared/bad.utils.ts",
    code: "// @ts-ignore\nexport const x = 1;\n",
  },
  {
    id: "TY6 bare JSON.parse",
    rule: "no-restricted-syntax",
    file: "apps/daemon/src/shared/bad.utils.ts",
    code: 'export const x: unknown = JSON.parse("{}");\n',
  },
  {
    id: "SEC7 shell: true outside infra/process",
    rule: "no-restricted-syntax",
    file: "apps/daemon/src/shared/bad.utils.ts",
    code: "export const opts = { shell: true };\n",
  },
  {
    id: "undescribed eslint-disable",
    rule: "@eslint-community/eslint-comments/require-description",
    file: "apps/daemon/src/shared/bad.utils.ts",
    code: "// eslint-disable-next-line no-console\nconsole.log(1);\n",
  },

  // Naming (docs/rules/naming.md)
  {
    id: "N1 type without T",
    rule: "@typescript-eslint/naming-convention",
    file: "apps/daemon/src/shared/bad.types.ts",
    code: "export type Repo = { id: string };\n",
  },
  {
    id: "N2 interface without I",
    rule: "@typescript-eslint/naming-convention",
    file: "apps/daemon/src/shared/bad.types.ts",
    code: "export interface Logger { log: () => void }\n",
  },
  {
    id: "N3 enum without E",
    rule: "@typescript-eslint/naming-convention",
    file: "apps/daemon/src/shared/bad.types.ts",
    code: "export enum Status { READY }\n",
  },
  {
    id: "N6 PascalCase file",
    rule: "check-file/filename-naming-convention",
    file: "apps/daemon/src/shared/BadName.ts",
    code: "export const x = 1;\n",
  },
  {
    id: "N6 camelCase folder",
    rule: "check-file/folder-naming-convention",
    file: "apps/daemon/src/modules/badFolder/index.ts",
    code: "export const x = 1;\n",
  },

  // App (docs/rules/react.md, design-system.md, api-calls.md, structure.md)
  {
    id: "R6 useEffect",
    rule: "no-restricted-syntax",
    file: "apps/mobile/src/modules/repos/hooks/use-bad.ts",
    code: 'import * as React from "react";\nexport function useBad(): void {\n  React.useEffect(() => undefined, []);\n}\n',
  },
  {
    id: "R9 createContext",
    rule: "no-restricted-imports",
    file: "apps/mobile/src/shared/utils/bad.utils.ts",
    code: 'import { createContext } from "react";\nexport const C = createContext(null);\n',
  },
  {
    id: "R10 useMemo",
    rule: "no-restricted-imports",
    file: "apps/mobile/src/shared/hooks/use-bad.ts",
    code: 'import { useMemo } from "react";\nexport const useBad = (): number => useMemo(() => 1, []);\n',
  },
  {
    id: "L10 raw Pressable",
    rule: "no-restricted-imports",
    file: "apps/mobile/src/modules/repos/components/bad.tsx",
    code: 'import { Pressable } from "react-native";\nexport const X = Pressable;\n',
  },
  {
    id: "I1 hardcoded JSX string",
    rule: "react/jsx-no-literals",
    file: "apps/mobile/src/modules/repos/components/bad.tsx",
    code: 'import { View } from "react-native";\nexport function Bad(): React.JSX.Element {\n  return <View>Hello there</View>;\n}\n',
  },
  {
    id: "I2 new Date",
    rule: "no-restricted-syntax",
    file: "apps/mobile/src/shared/utils/bad.utils.ts",
    code: "export const d = new Date();\n",
  },
  {
    id: "U4 hex colour",
    rule: "no-restricted-syntax",
    file: "apps/mobile/src/shared/constants/bad.constants.ts",
    code: 'export const RED = "#ff0000";\n',
  },
  {
    id: "U4 raw palette class",
    rule: "no-restricted-syntax",
    file: "apps/mobile/src/shared/constants/bad.constants.ts",
    code: 'export const CLS = "p-4 text-red-500";\n',
  },
  {
    id: "L9 WebSocket outside lib/api",
    rule: "no-restricted-globals",
    file: "apps/mobile/src/modules/repos/api/bad.queries.ts",
    code: 'export const ws = new WebSocket("ws://x");\n',
  },
  {
    id: "L9 fetch outside lib/api and lib/auth",
    rule: "no-restricted-globals",
    file: "apps/mobile/src/modules/repos/api/bad.queries.ts",
    code: 'export const r = fetch("https://x");\n',
  },
  {
    id: "L23 lib/auth may fetch but never open a WebSocket",
    rule: "no-restricted-globals",
    file: "apps/mobile/src/lib/auth/bad.ts",
    code: 'export const ws = new WebSocket("ws://x");\n',
  },
  {
    id: "L7 dayjs outside datetime-utils",
    rule: "no-restricted-imports",
    file: "apps/mobile/src/shared/utils/bad.utils.ts",
    code: 'import dayjs from "dayjs";\nexport const d = dayjs;\n',
  },
  ...[
    ["L16", "react-native-mmkv"],
    ["L17", "expo-secure-store"],
    ["L18", "expo-notifications"],
    ["L20", "expo-image-picker"],
    ["L21", "expo-haptics"],
    ["L22", "expo-crypto"],
  ].map(([id, lib]) => ({
    id: `${id ?? ""} ${lib ?? ""} outside its app wrapper`,
    rule: "no-restricted-imports",
    file: "apps/mobile/src/modules/chats/api/bad.ts",
    code: `import * as lib from "${lib ?? ""}";\nexport const x = lib;\n`,
  })),
  {
    id: "S4 app module imports another module",
    rule: "no-restricted-imports",
    file: "apps/mobile/src/modules/chats/components/bad.tsx",
    code: 'import { RepoList } from "@/modules/repos";\nexport const X = RepoList;\n',
  },
  {
    id: "S3 page imports module internals",
    rule: "no-restricted-imports",
    file: "apps/mobile/src/pages/repos/bad.tsx",
    code: 'import { RepoList } from "@/modules/repos/components/repo-list";\nexport const X = RepoList;\n',
  },
  {
    id: "S6 route imports a module",
    rule: "no-restricted-imports",
    file: "apps/mobile/src/app/bad.tsx",
    code: 'export { RepoList as default } from "@/modules/repos";\n',
  },
];

describe("every lint rule still fires", () => {
  it.each(CASES.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const [result] = await eslint.lintText(c.code, { filePath: `${ROOT}${c.file}` });
    const rules = (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
    expect(rules).toContain(c.rule);
  });

  it.each([
    ["apps/relay/src/infra/idtoken/ok.ts", "jose"],
    ["apps/relay/src/infra/sql/ok.ts", "better-sqlite3"],
    ["packages/crypto/src/ok.utils.ts", "@noble/hashes/sha2.js"],
    ["apps/mobile/src/lib/storage/ok.ts", "react-native-mmkv"],
  ])("allows %s to import %s", async (file, lib) => {
    const [result] = await eslint.lintText(`import * as lib from "${lib}";\nexport const x = lib;\n`, {
      filePath: `${ROOT}${file}`,
    });
    expect((result?.messages ?? []).map((m) => m.ruleId)).not.toContain("no-restricted-imports");
  });

  it("allows lib/auth to call fetch (sign-in)", async () => {
    const [result] = await eslint.lintText('export const r = fetch("https://x");\n', {
      filePath: `${ROOT}apps/mobile/src/lib/auth/ok.ts`,
    });
    expect((result?.messages ?? []).map((m) => m.ruleId)).not.toContain("no-restricted-globals");
  });

  it("allows the same code inside its wrapper", async () => {
    const [result] = await eslint.lintText(
      'import Database from "better-sqlite3";\nexport const x = Database;\n',
      {
        filePath: `${ROOT}apps/daemon/src/infra/db/ok.ts`,
      },
    );
    expect((result?.messages ?? []).map((m) => m.ruleId)).not.toContain("no-restricted-imports");
  });
});
