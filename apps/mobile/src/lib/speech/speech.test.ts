import { dictationAvailable, startDictation } from "./speech";

type TListener = (e: unknown) => void;
const mockListeners = new Map<string, TListener>();
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockOnDevice = jest.fn(() => true);
const mockGranted = jest.fn(() => true);

jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: () => true,
    supportsOnDeviceRecognition: () => mockOnDevice(),
    requestPermissionsAsync: () => Promise.resolve({ granted: mockGranted() }),
    addListener: (name: string, l: TListener) => {
      mockListeners.set(name, l);
      return {
        remove: () => {
          mockListeners.delete(name);
        },
      };
    },
    start: (o: unknown) => {
      mockStart(o);
    },
    stop: () => {
      mockStop();
    },
  },
}));

const emit = (name: string, e: unknown = null): void => {
  mockListeners.get(name)?.(e);
};

describe("dictation", () => {
  beforeEach(() => {
    mockListeners.clear();
    jest.clearAllMocks();
  });

  it("is offered only where speech is recognized on the device", () => {
    expect(dictationAvailable()).toBe(true);
    mockOnDevice.mockReturnValueOnce(false);
    expect(dictationAvailable()).toBe(false);
  });

  it("listens on the device and reports partial and final text until it ends", async () => {
    const seen: [string, boolean][] = [];
    const errors: string[] = [];
    let ended = false;
    const stop = await startDictation("en-US", {
      onText: (text, final) => seen.push([text, final]),
      onEnd: () => {
        ended = true;
      },
      onError: (m) => errors.push(m),
    });
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({ lang: "en-US", requiresOnDeviceRecognition: true, interimResults: true }),
    );
    emit("result", { isFinal: false, results: [{ transcript: "add a" }] });
    emit("result", { isFinal: true, results: [{ transcript: "add a test" }] });
    emit("error", { error: "no-speech", message: "quiet" });
    emit("error", { error: "audio-capture", message: "mic busy" });
    stop();
    expect(mockStop).toHaveBeenCalled();
    emit("end");
    expect(seen).toEqual([
      ["add a", false],
      ["add a test", true],
    ]);
    expect(errors).toEqual(["mic busy"]);
    expect(ended).toBe(true);
    expect(mockListeners.size).toBe(0);
  });

  it("fails without the permissions, before listening", async () => {
    mockGranted.mockReturnValueOnce(false);
    await expect(
      startDictation("en-US", { onText: jest.fn(), onEnd: jest.fn(), onError: jest.fn() }),
    ).rejects.toThrow("permission");
    expect(mockStart).not.toHaveBeenCalled();
  });
});
