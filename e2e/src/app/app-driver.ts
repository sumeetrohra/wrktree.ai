import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

import { REPO_ROOT } from "../harness.ts";

import { serveApp } from "./static-server.ts";

export const APP_DIST = join(REPO_ROOT, "apps", "mobile", "dist");

/**
 * The app's web build in a phone-sized Chromium, served next to the harness's daemon and relay.
 * With `videoDir`, every page is recorded.
 */
export class AppDriver {
  private constructor(
    readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
    readonly url: string,
    private readonly closeServer: () => Promise<void>,
  ) {}

  /**
   * `appHost` serves the app under another loopback name, e.g. `preview.localhost`, so a dev
   * relay's `<token>.preview.localhost` previews are same-site with it (their cookie works in a frame).
   */
  static async start(opts: { videoDir?: string; appHost?: string } = {}): Promise<AppDriver> {
    const served = await serveApp(APP_DIST);
    const app = opts.appHost ? { ...served, url: served.url.replace("127.0.0.1", opts.appHost) } : served;
    const browser = await chromium.launch();
    if (opts.videoDir) mkdirSync(opts.videoDir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      ...(opts.videoDir ? { recordVideo: { dir: opts.videoDir, size: { width: 390, height: 844 } } } : {}),
    });
    const page = await context.newPage();
    return new AppDriver(browser, context, page, app.url, () => app.close());
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(this.url + path);
  }

  async stop(): Promise<string | null> {
    const video = this.page.video();
    await this.context.close();
    await this.browser.close();
    await this.closeServer();
    return video ? video.path() : null;
  }
}
