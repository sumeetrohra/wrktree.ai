import type { ErrorEvent } from "@sentry/react-native";

import { scrubBreadcrumb, scrubEvent } from "./sentry.utils";

describe("sentry scrubbing", () => {
  it("breadcrumbs keep their kind, never their text or data", () => {
    expect(
      scrubBreadcrumb({
        type: "http",
        category: "fetch",
        level: "info",
        timestamp: 1,
        message: "Write NOTES.md with the secret plan",
        data: { url: "https://relay.example.com/v1/devices?token=abc" },
      }),
    ).toEqual({ type: "http", category: "fetch", level: "info", timestamp: 1 });
  });

  it("events drop the user, request and extras, and scrub their breadcrumbs", () => {
    const e: ErrorEvent = {
      type: undefined,
      exception: { values: [{ type: "TypeError", value: "x is undefined" }] },
      user: { email: "me@example.com" },
      request: { url: "https://relay.example.com/?k=key" },
      extra: { prompt: "hello" },
      breadcrumbs: [{ category: "console", message: "the agent said hi" }],
    };
    const out = scrubEvent(e);
    expect(out.exception).toEqual(e.exception);
    expect(JSON.stringify(out)).not.toMatch(/me@example|k=key|hello|agent said/);
  });
});
