import { runQuiet } from "#src/lib/process/index.js";

function openerFor(url: string): string[] {
  switch (process.platform) {
    case "darwin":
      return ["open", url];
    case "win32":
      return ["cmd", "/c", "start", "", url];
    default:
      return ["xdg-open", url];
  }
}

/** Opens `url` in the default browser; false when there is none (headless, SSH). */
export async function openInBrowser(url: string): Promise<boolean> {
  return (await runQuiet(openerFor(url))).code === 0;
}
