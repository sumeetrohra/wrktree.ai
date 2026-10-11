import type { TErrorCode } from "@agentdeck/protocol";

/** What the UI shows for a failed daemon call: a code and the i18n key to render (I4). */
export type TAppError = {
  code: TErrorCode | "DISCONNECTED";
  i18nKey: string;
  message: string;
};
