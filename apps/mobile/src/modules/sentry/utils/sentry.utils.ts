import type { Breadcrumb, ErrorEvent } from "@sentry/react-native";

/**
 * Breadcrumbs keep what kind of thing happened, never its text or data (SEC8): a console line, a
 * fetch URL or a navigation could carry chat content, paths or tokens.
 */
export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb {
  return {
    ...(b.type === undefined ? {} : { type: b.type }),
    ...(b.category === undefined ? {} : { category: b.category }),
    ...(b.level === undefined ? {} : { level: b.level }),
    ...(b.timestamp === undefined ? {} : { timestamp: b.timestamp }),
  };
}

/** An error report keeps the error and the stack; who, which request and extras are dropped. */
export function scrubEvent(e: ErrorEvent): ErrorEvent {
  const { request: _request, user: _user, extra: _extra, server_name: _server, ...rest } = e;
  return { ...rest, breadcrumbs: (e.breadcrumbs ?? []).map(scrubBreadcrumb) };
}
