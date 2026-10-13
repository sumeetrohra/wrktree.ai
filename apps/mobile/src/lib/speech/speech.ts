import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

import type { TDictationHandlers } from "./speech.types";

/**
 * Dictation is offered only where speech is recognized on the device: no audio leaves the phone,
 * only the text the user then sends.
 */
export function dictationAvailable(): boolean {
  try {
    return (
      ExpoSpeechRecognitionModule.isRecognitionAvailable() &&
      ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()
    );
  } catch {
    return false;
  }
}

/** Starts listening; returns `stop` (what was said so far still arrives as final text). */
export async function startDictation(lang: string, h: TDictationHandlers): Promise<() => void> {
  const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!permission.granted) throw new Error("permission");
  const subs = [
    ExpoSpeechRecognitionModule.addListener("result", (e) => {
      h.onText(e.results[0]?.transcript ?? "", e.isFinal);
    }),
    ExpoSpeechRecognitionModule.addListener("error", (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") h.onError(e.message);
    }),
    ExpoSpeechRecognitionModule.addListener("end", () => {
      for (const s of subs) s.remove();
      h.onEnd();
    }),
  ];
  ExpoSpeechRecognitionModule.start({
    lang,
    interimResults: true,
    continuous: true,
    requiresOnDeviceRecognition: true,
    addsPunctuation: true,
  });
  return () => {
    ExpoSpeechRecognitionModule.stop();
  };
}
