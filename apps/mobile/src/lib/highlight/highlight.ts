import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import css from "shiki/langs/css.mjs";
import go from "shiki/langs/go.mjs";
import html from "shiki/langs/html.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import markdown from "shiki/langs/markdown.mjs";
import python from "shiki/langs/python.mjs";
import rust from "shiki/langs/rust.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";

/** One colored run of a line. */
export type TToken = { content: string; color: string | null };
export type TTokenLines = TToken[][];

/**
 * The languages the code and diff views color, loaded with the highlighter. A fixed set keeps the
 * bundle small (JSX uses the JavaScript grammar); anything else renders plain.
 */
const LANGS = { typescript, tsx, javascript, json, markdown, css, html, python, go, rust, shellscript, yaml };
export type TLang = keyof typeof LANGS;

const EXT: Record<string, TLang> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  py: "python",
  go: "go",
  rs: "rust",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  yml: "yaml",
  yaml: "yaml",
};

/** The language for a file path, or null to render it plain. */
export function languageFor(path: string): TLang | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(EXT, ext) ? (EXT[ext] ?? null) : null;
}

let highlighter: Promise<HighlighterCore> | null = null;

/** Created once, on first use: the JavaScript regex engine (no WebAssembly, runs on Hermes). */
function core(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: Object.values(LANGS),
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

/** Colors `code` line by line for the light or dark theme. */
export async function tokenize(code: string, lang: TLang, dark: boolean): Promise<TTokenLines> {
  const h = await core();
  const lines = h.codeToTokensBase(code, { lang, theme: dark ? "github-dark" : "github-light" });
  return lines.map((line) => line.map((t) => ({ content: t.content, color: t.color ?? null })));
}
