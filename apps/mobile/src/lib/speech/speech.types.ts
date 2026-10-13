export type TDictationHandlers = {
  /** The current utterance so far (`final` once it is done; the next one starts fresh). */
  onText: (text: string, final: boolean) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};
