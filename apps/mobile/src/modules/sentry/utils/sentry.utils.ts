import type { TAppError } from "@/lib/api";

/**
 * Error reporting (I5, L8). A no-op until a Sentry DSN is configured: the SDK is added here,
 * and only here, when it is. Nothing else in the app reports errors directly.
 */
export function captureAppError(_error: TAppError): void {
  // Intentionally empty until Sentry is configured.
}

export function captureException(_error: unknown): void {
  // Intentionally empty until Sentry is configured.
}
