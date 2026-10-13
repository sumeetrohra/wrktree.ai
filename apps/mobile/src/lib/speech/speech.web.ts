import type { TDictationHandlers } from "./speech.types";

/** The web build doesn't dictate: browsers send the audio to their vendor's speech service. */
export function dictationAvailable(): boolean {
  return false;
}

export function startDictation(_lang: string, _h: TDictationHandlers): Promise<() => void> {
  return Promise.reject(new Error("unavailable"));
}
